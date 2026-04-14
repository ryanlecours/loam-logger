import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies BEFORE importing the router
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('./password.utils', () => ({
  validatePassword: jest.fn().mockReturnValue({ isValid: true }),
  hashPassword: jest.fn().mockResolvedValue('hashed_password_123'),
  verifyPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/password-notification.service', () => ({
  sendPasswordAddedNotification: jest.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock other dependencies that mobile.route.ts imports
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

jest.mock('./ensureUserFromGoogle', () => ({
  ensureUserFromGoogle: jest.fn(),
}));

jest.mock('./token', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  verifyToken: jest.fn(),
}));

jest.mock('./session-issuer', () => ({
  issueMobileTokens: jest.fn().mockResolvedValue({
    accessToken: 'new_access_token',
    refreshToken: 'new_refresh_token',
  }),
}));

jest.mock('./recent-auth', () => ({
  updateLastAuthAt: jest.fn().mockResolvedValue(undefined),
}));

import router from './mobile.route';
import { prisma } from '../lib/prisma';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { validatePassword, hashPassword, verifyPassword } from './password.utils';
import { sendPasswordAddedNotification, sendPasswordChangedNotification } from '../services/password-notification.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCheckMutationRateLimit = checkMutationRateLimit as jest.Mock;
const mockValidatePassword = validatePassword as jest.Mock;
const mockHashPassword = hashPassword as jest.Mock;
const mockVerifyPassword = verifyPassword as jest.Mock;
const mockSendPasswordAddedNotification = sendPasswordAddedNotification as jest.Mock;
const mockSendPasswordChangedNotification = sendPasswordChangedNotification as jest.Mock;

// Helper to get route handler
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

function createMockResponse(): Partial<Response> & { status: jest.Mock; json: jest.Mock; send: jest.Mock; setHeader: jest.Mock } {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('POST /mobile/password/add', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/mobile/password/add', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/password/add');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckMutationRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
    mockValidatePassword.mockReturnValue({ isValid: true });
    mockHashPassword.mockResolvedValue('hashed_password_123');
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      const req = createMockRequest({ sessionUser: undefined });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should return 429 when rate limited', async () => {
      mockCheckMutationRateLimit.mockResolvedValue({ allowed: false, retryAfter: 3600 });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Too many password attempts. Please try again later.',
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfter: 3600 },
      });
    });
  });

  describe('Validation', () => {
    it('should return 400 when password is missing', async () => {
      const req = createMockRequest({ body: {} });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Password is required',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 400 when password is weak', async () => {
      mockValidatePassword.mockReturnValue({ isValid: false, error: 'Password too short' });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Password too short',
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('Account State', () => {
    it('should return 500 when user not found (data integrity issue)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to add password',
        code: 'INTERNAL_ERROR',
      });
    });

    it('should return 400 when no OAuth provider is linked', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        accounts: [],
      });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot add password to this account type',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 403 ALREADY_HAS_PASSWORD when user already has password', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        accounts: [{ provider: 'google' }],
      });
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Account already has a password. Use change-password instead.',
        code: 'ALREADY_HAS_PASSWORD',
      });
    });
  });

  describe('Success Case', () => {
    it('should add password successfully for OAuth-only account', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        accounts: [{ provider: 'google' }],
      });
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockHashPassword).toHaveBeenCalledWith('SecurePass123!');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-123', passwordHash: null },
        data: { passwordHash: 'hashed_password_123' },
      });
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should send notification email on success', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        accounts: [{ provider: 'google' }],
      });
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockSendPasswordAddedNotification).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      });
    });
  });
});

describe('POST /mobile/password/change', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/mobile/password/change', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/password/change');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckMutationRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
    mockValidatePassword.mockReturnValue({ isValid: true });
    mockHashPassword.mockResolvedValue('new_hashed_password');
    mockVerifyPassword.mockResolvedValue(true);
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      const req = createMockRequest({
        sessionUser: undefined,
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should return 429 when rate limited', async () => {
      mockCheckMutationRateLimit.mockResolvedValue({ allowed: false, retryAfter: 3600 });
      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Too many password change attempts. Please try again later.',
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfter: 3600 },
      });
    });
  });

  describe('Validation', () => {
    it('should return 400 when current password is missing', async () => {
      const req = createMockRequest({ body: { newPassword: 'newPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Current and new password are required',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 400 when new password is missing', async () => {
      const req = createMockRequest({ body: { currentPassword: 'oldPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Current and new password are required',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 400 when new password is weak', async () => {
      mockValidatePassword.mockReturnValue({ isValid: false, error: 'Password too short' });
      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'weak' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Password too short',
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('Account State', () => {
    it('should return 400 when user has no password (OAuth-only)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        passwordHash: null,
        mustChangePassword: false,
      });
      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Cannot change password for this account',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 500 when user not found (data integrity issue)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to change password',
        code: 'INTERNAL_ERROR',
      });
    });

    it('should return 401 when current password is incorrect', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        passwordHash: 'existing_hash',
        mustChangePassword: false,
      });
      mockVerifyPassword.mockResolvedValue(false);

      const req = createMockRequest({
        body: { currentPassword: 'wrongPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Current password is incorrect',
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('Success Case', () => {
    it('should change password successfully', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'existing_hash',
        mustChangePassword: true,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockVerifyPassword).toHaveBeenCalledWith('oldPass123!', 'existing_hash');
      expect(mockHashPassword).toHaveBeenCalledWith('newPass123!');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          passwordHash: 'new_hashed_password',
          mustChangePassword: false,
          sessionTokenVersion: { increment: 1 },
        },
      });
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
      });
    });

    it('should send notification email on success', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'existing_hash',
        mustChangePassword: false,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockSendPasswordChangedNotification).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      });
    });

    it('should clear mustChangePassword flag on success', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'existing_hash',
        mustChangePassword: true,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      const req = createMockRequest({
        body: { currentPassword: 'oldPass123!', newPassword: 'newPass123!' },
      });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as Response);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: false }),
        })
      );
    });
  });
});
