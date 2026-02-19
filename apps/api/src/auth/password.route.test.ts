import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies BEFORE importing the router
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../lib/api-response', () => ({
  sendBadRequest: jest.fn((res, msg) => res.status(400).json({ error: msg })),
  sendUnauthorized: jest.fn((res, msg) => res.status(401).json({ error: msg || 'Unauthorized' })),
  sendForbidden: jest.fn((res, msg, code) => res.status(403).json({ error: msg, code })),
  sendInternalError: jest.fn((res, msg) => res.status(500).json({ error: msg })),
  sendTooManyRequests: jest.fn((res, msg, retryAfter) => res.status(429).json({ error: msg, retryAfter })),
}));

jest.mock('../lib/rate-limit', () => ({
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('./recent-auth', () => ({
  checkRecentAuth: jest.fn().mockResolvedValue({ valid: true, lastAuthAt: new Date() }),
}));

jest.mock('./password.utils', () => ({
  validatePassword: jest.fn().mockReturnValue({ isValid: true }),
  hashPassword: jest.fn().mockResolvedValue('hashed_password_123'),
}));

jest.mock('../services/password-notification.service', () => ({
  sendPasswordAddedNotification: jest.fn().mockResolvedValue(undefined),
}));

import router from './password.route';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden } from '../lib/api-response';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { checkRecentAuth } from './recent-auth';
import { validatePassword, hashPassword } from './password.utils';
import { sendPasswordAddedNotification } from '../services/password-notification.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCheckRecentAuth = checkRecentAuth as jest.Mock;
const mockCheckMutationRateLimit = checkMutationRateLimit as jest.Mock;
const mockValidatePassword = validatePassword as jest.Mock;
const mockHashPassword = hashPassword as jest.Mock;
const mockSendPasswordAddedNotification = sendPasswordAddedNotification as jest.Mock;

// Helper to get route handler - skip middleware, get the actual handler
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  // The actual handler is after express.json() and requireRecentAuth middleware
  const handlers = layer?.route?.stack;
  return handlers?.[handlers.length - 1]?.handle;
}

// Helper to invoke handler
async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    sessionUser: { uid: 'user-123', email: 'test@example.com' },
    body: { newPassword: 'SecurePass123!' },
    ...overrides,
  };
}

function createMockResponse(): Partial<Response> & { status: jest.Mock; json: jest.Mock } {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('POST /password/add', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/password/add', 'post');
    if (!handler) throw new Error('Handler not found');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default mocks
    mockCheckRecentAuth.mockResolvedValue({ valid: true, lastAuthAt: new Date() });
    mockCheckMutationRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
    mockValidatePassword.mockReturnValue({ isValid: true });
    mockHashPassword.mockResolvedValue('hashed_password_123');
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      const req = createMockRequest({ sessionUser: undefined });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(sendUnauthorized).toHaveBeenCalled();
    });
  });

  describe('Rate Limiting', () => {
    it('should return 429 when rate limited', async () => {
      mockCheckMutationRateLimit.mockResolvedValue({ allowed: false, retryAfter: 3600 });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Validation', () => {
    it('should return 400 when password is missing', async () => {
      const req = createMockRequest({ body: {} });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(sendBadRequest).toHaveBeenCalledWith(res, 'Password is required');
    });

    it('should return 400 when password is weak', async () => {
      mockValidatePassword.mockReturnValue({ isValid: false, error: 'Password too short' });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(sendBadRequest).toHaveBeenCalledWith(res, 'Password too short');
    });
  });

  describe('Account State', () => {
    it('should return 403 ALREADY_HAS_PASSWORD when user already has password', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: 'existing_hash',
        accounts: [{ provider: 'google' }],
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(sendForbidden).toHaveBeenCalledWith(
        res,
        'Account already has a password. Use change-password instead.',
        'ALREADY_HAS_PASSWORD'
      );
    });

    it('should return 400 when no OAuth provider is linked', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        accounts: [], // No providers linked
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(sendBadRequest).toHaveBeenCalledWith(res, 'Cannot add password to this account type');
    });
  });

  describe('Success Case', () => {
    it('should add password successfully for Google-only account', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        accounts: [{ provider: 'google' }],
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockHashPassword).toHaveBeenCalledWith('SecurePass123!');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { passwordHash: 'hashed_password_123' },
      });
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should send notification email on success', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        passwordHash: null,
        accounts: [{ provider: 'google' }],
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockSendPasswordAddedNotification).toHaveBeenCalledWith('user-123');
    });
  });
});

// Test requireRecentAuth middleware separately
describe('requireRecentAuth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should block when recent auth check fails', async () => {
    // Import the middleware directly
    const { requireRecentAuth } = await import('./requireRecentAuth');

    mockCheckRecentAuth.mockResolvedValue({ valid: false, reason: 'AUTH_EXPIRED' });

    const mockReq = { sessionUser: { uid: 'user-123' } } as Partial<Request>;
    const mockRes = createMockResponse();
    const mockNext = jest.fn();

    const middleware = requireRecentAuth();
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(sendForbidden).toHaveBeenCalledWith(
      mockRes,
      'This action requires recent authentication. Please log in again.',
      'RECENT_AUTH_REQUIRED'
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next when recent auth is valid', async () => {
    const { requireRecentAuth } = await import('./requireRecentAuth');

    mockCheckRecentAuth.mockResolvedValue({ valid: true, lastAuthAt: new Date() });

    const mockReq = { sessionUser: { uid: 'user-123' } } as Partial<Request>;
    const mockRes = createMockResponse();
    const mockNext = jest.fn();

    const middleware = requireRecentAuth();
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(sendForbidden).not.toHaveBeenCalled();
  });
});
