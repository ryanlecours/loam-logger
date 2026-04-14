import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies BEFORE importing the router
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAdminRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('../services/password-reset.service', () => ({
  createPasswordResetToken: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));

// The service layer we care about for this test. Everything else the admin
// router imports just needs to not explode during module load.
jest.mock('../services/activation.service', () => ({
  activateWaitlistUser: jest.fn(),
  generateTempPassword: jest.fn(),
}));
jest.mock('../auth/password.utils', () => ({
  hashPassword: jest.fn(),
}));
jest.mock('../services/email.service', () => ({
  sendEmail: jest.fn(),
  sendReactEmailWithAudit: jest.fn(),
}));
jest.mock('@react-email/render', () => ({
  render: jest.fn().mockResolvedValue('<html></html>'),
}));
jest.mock('../lib/unsubscribe-token', () => ({
  generateUnsubscribeToken: jest.fn().mockReturnValue('tok'),
}));

// Mock the admin middleware — we track that the router wires it up, but for
// handler-level tests we just pass through.
jest.mock('../auth/adminMiddleware', () => ({
  requireAdmin: jest.fn((_req: Request, _res: Response, next: NextFunction) => next()),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logError: jest.fn(),
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

import router from './admin';
import { prisma } from '../lib/prisma';
import { checkAdminRateLimit } from '../lib/rate-limit';
import {
  createPasswordResetToken,
  sendPasswordResetEmail,
} from '../services/password-reset.service';
import { requireAdmin } from '../auth/adminMiddleware';
import { logger } from '../lib/logger';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockUserFindUnique = mockPrisma.user.findUnique as unknown as jest.Mock;
const mockCheckAdminRateLimit = checkAdminRateLimit as jest.Mock;
const mockCreateToken = createPasswordResetToken as jest.Mock;
const mockSendEmail = sendPasswordResetEmail as jest.Mock;
const mockRequireAdmin = requireAdmin as unknown as jest.Mock;
const mockLoggerInfo = logger.info as unknown as jest.Mock;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
  name?: string;
  handle?: RequestHandler;
}

function getHandler(path: string, method: string): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
  const handlers = layer?.route?.stack;
  return handlers?.[handlers.length - 1]?.handle;
}

async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response,
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    sessionUser: { uid: 'admin_1', email: 'admin@loamlogger.app' },
    params: { userId: '11111111-1111-1111-1111-111111111111' },
    body: {},
    headers: {},
    cookies: {},
    ...overrides,
  } as Partial<Request>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckAdminRateLimit.mockResolvedValue({ allowed: true });
});

describe('admin router — middleware wiring', () => {
  it('installs requireAdmin as a Router-level guard before any route handler', () => {
    // A Router-level middleware (via router.use) registers as a stack layer
    // with no `.route` and a direct `.handle` reference. If someone removes
    // `router.use(requireAdmin)`, this test fails loudly.
    const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
    const middlewareLayers = routerStack.filter((l) => !l.route);
    const hasRequireAdminGuard = middlewareLayers.some((l) => l.handle === mockRequireAdmin);
    expect(hasRequireAdminGuard).toBe(true);
  });
});

describe('POST /users/:userId/send-password-reset', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/users/:userId/send-password-reset', 'post');
    if (!handler) {
      throw new Error('Handler not found for /users/:userId/send-password-reset');
    }
  });

  describe('Authentication', () => {
    it('returns 401 when sessionUser is missing (safety net behind requireAdmin)', async () => {
      const req = createMockRequest({ sessionUser: undefined });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockCreateToken).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('Input validation', () => {
    it('returns 400 when userId is not a valid UUID/CUID', async () => {
      const req = createMockRequest({ params: { userId: "' OR 1=1 --" } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockCreateToken).not.toHaveBeenCalled();
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 when the per-target admin rate limit is exceeded', async () => {
      mockCheckAdminRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
      expect(mockCreateToken).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('keys the rate limit by target user (not by admin)', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'target@example.com',
        name: 'Target',
      });
      mockCreateToken.mockResolvedValue('raw');

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockCheckAdminRateLimit).toHaveBeenCalledWith(
        'sendPasswordReset',
        '11111111-1111-1111-1111-111111111111',
      );
    });
  });

  describe('User lookup', () => {
    it('returns 400 when the target user does not exist', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreateToken).not.toHaveBeenCalled();
    });
  });

  describe('Happy path', () => {
    it('creates a token, sends the email, logs the action, and returns 200', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'target@example.com',
        name: 'Target User',
      });
      mockCreateToken.mockResolvedValue('raw-token-xyz');

      const req = createMockRequest();
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockCreateToken).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '11111111-1111-1111-1111-111111111111',
          email: 'target@example.com',
        }),
        'raw-token-xyz',
        'admin_password_reset',
      );
      // Structured log, no PII in the message string.
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '11111111-1111-1111-1111-111111111111',
          adminUserId: 'admin_1',
        }),
        expect.any(String),
      );
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
