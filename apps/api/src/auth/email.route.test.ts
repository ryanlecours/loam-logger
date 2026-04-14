import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies BEFORE importing the router
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('./password.utils', () => ({
  validatePassword: jest.fn().mockReturnValue({ isValid: true }),
  hashPassword: jest.fn().mockResolvedValue('hashed_new_password'),
  verifyPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('./email.utils', () => ({
  validateEmailFormat: jest.fn().mockReturnValue(true),
}));

jest.mock('./utils', () => ({
  normalizeEmail: jest.fn((e: string) => e.trim().toLowerCase()),
  getClientIp: jest.fn().mockReturnValue('1.2.3.4'),
}));

jest.mock('./session', () => ({
  setSessionCookie: jest.fn(),
  clearSessionCookie: jest.fn(),
}));

jest.mock('./session-issuer', () => ({
  issueWebSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./csrf', () => ({
  setCsrfCookie: jest.fn().mockReturnValue('csrf_token'),
}));

jest.mock('./recent-auth', () => ({
  updateLastAuthAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./requireRecentAuth', () => ({
  requireRecentAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../services/password-notification.service', () => ({
  sendPasswordChangedNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/password-reset.service', () => ({
  consumePasswordResetToken: jest.fn(),
  createPasswordResetToken: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));

jest.mock('../services/signup.service', () => ({
  createNewUser: jest.fn(),
  verifyEmailAvailable: jest.fn(),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import router from './email.route';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit } from '../lib/rate-limit';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  sendPasswordResetEmail,
} from '../services/password-reset.service';
import { validateEmailFormat } from './email.utils';
import { hashPassword, validatePassword } from './password.utils';
import { logger } from '../lib/logger';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockUserFindUnique = mockPrisma.user.findUnique as unknown as jest.Mock;
const mockUserUpdate = mockPrisma.user.update as unknown as jest.Mock;
const mockCheckAuthRateLimit = checkAuthRateLimit as jest.Mock;
const mockConsumeToken = consumePasswordResetToken as jest.Mock;
const mockCreateToken = createPasswordResetToken as jest.Mock;
const mockSendEmail = sendPasswordResetEmail as jest.Mock;
const mockValidateEmailFormat = validateEmailFormat as jest.Mock;
const mockHashPassword = hashPassword as jest.Mock;
const mockValidatePassword = validatePassword as jest.Mock;
const mockLoggerWarn = logger.warn as unknown as jest.Mock;
const mockLoggerInfo = logger.info as unknown as jest.Mock;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
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
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
  return res;
}

function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    body: {},
    headers: {},
    cookies: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  mockValidateEmailFormat.mockReturnValue(true);
  mockValidatePassword.mockReturnValue({ isValid: true });
  mockHashPassword.mockResolvedValue('hashed_new_password');
});

// ============================================================================
// POST /forgot-password
// ============================================================================

describe('POST /forgot-password', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/forgot-password', 'post');
    if (!handler) throw new Error('Handler not found for /forgot-password');
  });

  describe('Rate limiting', () => {
    it('returns 429 when per-IP rate limit is exceeded', async () => {
      mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
      const req = createMockRequest({ body: { email: 'rider@example.com' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(mockCreateToken).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('Enumeration resistance (always 200)', () => {
    it('returns 200 + no email send when the email does not match any user', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      const req = createMockRequest({ body: { email: 'nobody@example.com' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalledWith({ ok: true });
      expect(mockCreateToken).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('returns 200 when the email fails format validation (no token created)', async () => {
      mockValidateEmailFormat.mockReturnValue(false);
      const req = createMockRequest({ body: { email: 'not-an-email' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalledWith({ ok: true });
      expect(mockUserFindUnique).not.toHaveBeenCalled();
      expect(mockCreateToken).not.toHaveBeenCalled();
    });

    it('returns 200 even if the email-send step throws (no leak of failure state)', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'user_1',
        email: 'rider@example.com',
        name: 'Alex',
      });
      mockCreateToken.mockResolvedValue('raw-token');
      mockSendEmail.mockRejectedValue(new Error('Resend down'));

      const req = createMockRequest({ body: { email: 'rider@example.com' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('Validation', () => {
    it('returns 400 when email is missing from body', async () => {
      const req = createMockRequest({ body: {} });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('Happy path', () => {
    it('creates a token, sends the email, and returns 200 for a known user', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'user_1',
        email: 'rider@example.com',
        name: 'Alex Example',
      });
      mockCreateToken.mockResolvedValue('raw-token-abc');

      const req = createMockRequest({ body: { email: 'rider@example.com' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockCreateToken).toHaveBeenCalledWith('user_1');
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user_1', email: 'rider@example.com' }),
        'raw-token-abc',
        'user_action',
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });
});

// ============================================================================
// POST /reset-password
// ============================================================================

describe('POST /reset-password', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/reset-password', 'post');
    if (!handler) throw new Error('Handler not found for /reset-password');
  });

  describe('Rate limiting', () => {
    it('returns 429 when per-IP rate limit is exceeded', async () => {
      mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(mockConsumeToken).not.toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('returns 400 when the token is missing', async () => {
      const req = createMockRequest({ body: { newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockConsumeToken).not.toHaveBeenCalled();
    });

    it('returns 400 when the new password is missing', async () => {
      const req = createMockRequest({ body: { token: 't' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockConsumeToken).not.toHaveBeenCalled();
    });

    it('returns 400 when the password fails strength validation (before touching the token)', async () => {
      mockValidatePassword.mockReturnValue({ isValid: false, error: 'Too short' });
      const req = createMockRequest({ body: { token: 't', newPassword: 'weak' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockConsumeToken).not.toHaveBeenCalled();
    });
  });

  describe('Token states', () => {
    it('returns TOKEN_INVALID (400) when the token is not found — no warn log', async () => {
      mockConsumeToken.mockResolvedValue({ ok: false, reason: 'not_found' });
      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' }),
      );
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('returns TOKEN_INVALID (400) when the token was already used — warns with userId + clientIp', async () => {
      mockConsumeToken.mockResolvedValue({
        ok: false,
        reason: 'already_used',
        userId: 'user_42',
      });
      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      // Client-side code stays generic — no enumeration leak.
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_INVALID' }),
      );
      // Server-side: security audit log fires.
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_42', clientIp: '1.2.3.4' }),
        expect.stringContaining('reuse'),
      );
    });

    it('returns TOKEN_EXPIRED (400) when the token is past its expiry — no warn log', async () => {
      mockConsumeToken.mockResolvedValue({ ok: false, reason: 'expired' });
      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      );
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('returns TOKEN_EXPIRED (400) for race_expired and logs at info (not warn, not debug)', async () => {
      mockConsumeToken.mockResolvedValue({
        ok: false,
        reason: 'race_expired',
        userId: 'user_11',
      });
      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      );
      // Benign case — should NOT trigger the security-alert warn log, but
      // should still be visible in production log pipelines (hence info, not debug).
      expect(mockLoggerWarn).not.toHaveBeenCalled();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_11' }),
        expect.any(String),
      );
    });
  });

  describe('Happy path', () => {
    it('hashes the new password, bumps sessionTokenVersion, and returns 200', async () => {
      mockConsumeToken.mockResolvedValue({ ok: true, userId: 'user_1' });
      mockUserFindUnique.mockResolvedValue({
        id: 'user_1',
        email: 'rider@example.com',
        name: 'Alex',
      });
      mockUserUpdate.mockResolvedValue({});

      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockHashPassword).toHaveBeenCalledWith('NewPass123!');
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: {
          passwordHash: 'hashed_new_password',
          mustChangePassword: false,
          sessionTokenVersion: { increment: 1 },
        },
      });
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('defensively rejects if the user has vanished between token consumption and update', async () => {
      mockConsumeToken.mockResolvedValue({ ok: true, userId: 'ghost_user' });
      mockUserFindUnique.mockResolvedValue(null);

      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });
  });
});
