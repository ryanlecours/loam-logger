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
  checkSignupRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('../services/email-verification.service', () => ({
  EMAIL_VERIFICATION_REQUIRED_CODE: 'EMAIL_VERIFICATION_REQUIRED',
  EMAIL_VERIFICATION_REQUIRED_MESSAGE: 'Check your inbox for a link to verify your email, then sign in.',
  isEmailVerificationPending: (u: { emailVerificationRequired: boolean; emailVerified: Date | null }) =>
    u.emailVerificationRequired && !u.emailVerified,
  sendVerificationEmailWithinLimit: jest.fn().mockResolvedValue(true),
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
  getUserAgent: jest.fn().mockReturnValue('LoamLogger/1.0 CFNetwork'),
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
  isWellFormedCsrfToken: jest.requireActual('./csrf').isWellFormedCsrfToken,
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

jest.mock('../services/turnstile', () => ({
  checkTurnstileConfig: jest.fn(),
  evaluateSignupTurnstile: jest.fn().mockResolvedValue(null),
  requiresUnverifiedWebCap: jest.fn().mockReturnValue(false),
  reportSignupTurnstile: jest.fn(),
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
import { setCsrfCookie } from './csrf';
import { createNewUser, verifyEmailAvailable } from '../services/signup.service';
import { sendVerificationEmailWithinLimit } from '../services/email-verification.service';
import { issueWebSession } from './session-issuer';
import { checkSignupRateLimit } from '../lib/rate-limit';
import { verifyPassword } from './password.utils';
import { evaluateSignupTurnstile, reportSignupTurnstile, requiresUnverifiedWebCap } from '../services/turnstile';

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

/** Lets the fire-and-forget token and email work run before asserting on it. */
const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));
const mockLoggerError = logger.error as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  mockValidateEmailFormat.mockReturnValue(true);
  mockValidatePassword.mockReturnValue({ isValid: true });
  mockHashPassword.mockResolvedValue('hashed_new_password');
  (checkSignupRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  (verifyPassword as jest.Mock).mockResolvedValue(true);
  (evaluateSignupTurnstile as jest.Mock).mockResolvedValue(null);
  (requiresUnverifiedWebCap as jest.Mock).mockReturnValue(false);
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
      await flushBackgroundWork();
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_1' }),
        '[EmailAuth] Forgot password email send failed',
      );
    });

    // A known address used to wait on the token write and the email provider
    // before answering, so response time told an attacker it was registered.
    it('answers a known address without waiting for the token or the email', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user_1', email: 'rider@example.com', name: 'Alex' });
      mockCreateToken.mockReturnValue(new Promise(() => {}));

      const req = createMockRequest({ body: { email: 'rider@example.com' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockCreateToken).toHaveBeenCalledWith('user_1');
      expect(mockSendEmail).not.toHaveBeenCalled();
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
      await flushBackgroundWork();

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
// POST /signup: email already registered
// ============================================================================

describe('POST /signup when the email is taken', () => {
  it('returns 409 with the EMAIL_EXISTS code and creates nothing', async () => {
    const handler = getHandler('/signup', 'post');
    (verifyEmailAvailable as jest.Mock).mockResolvedValue({ available: false });
    const req = createMockRequest({
      body: { email: 'taken@example.com', name: 'Rider', password: 'StrongPassw0rd!' },
    });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(409);
    // Clients branch on the code, not the wording, to offer log in or reset.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_EXISTS' }));
    expect(createNewUser).not.toHaveBeenCalled();
  });
});

// ============================================================================
// POST /signup: email verification
// ============================================================================

describe('POST /signup', () => {
  const body = { email: 'New@Example.com', name: ' Rider ', password: 'StrongPassw0rd!' };

  beforeEach(() => {
    (verifyEmailAvailable as jest.Mock).mockResolvedValue({ available: true, email: 'new@example.com' });
    (createNewUser as jest.Mock).mockResolvedValue({
      user: { id: 'user_new', email: 'new@example.com', name: 'Rider' },
    });
  });

  it('creates the account, emails a verification link, and starts no session', async () => {
    const handler = getHandler('/signup', 'post');
    const req = createMockRequest({ body });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true, verificationRequired: true, email: 'new@example.com' });
    expect(sendVerificationEmailWithinLimit).toHaveBeenCalledWith(
      { id: 'user_new', email: 'new@example.com', name: 'Rider' },
      'user_action',
    );
    expect(issueWebSession).not.toHaveBeenCalled();
    expect(setCsrfCookie).not.toHaveBeenCalled();
  });

  it('records the signup IP and user agent', async () => {
    const handler = getHandler('/signup', 'post');
    const req = createMockRequest({ body });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(createNewUser).toHaveBeenCalledWith(
      expect.objectContaining({ signupIp: '1.2.3.4', signupUserAgent: 'LoamLogger/1.0 CFNetwork' }),
    );
  });

  it('returns 429 from the stacked signup windows before creating anything', async () => {
    (checkSignupRateLimit as jest.Mock).mockResolvedValue({ allowed: false, retryAfter: 3000 });
    const handler = getHandler('/signup', 'post');
    const req = createMockRequest({ body });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(checkSignupRateLimit).toHaveBeenCalledWith('1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(createNewUser).not.toHaveBeenCalled();
  });

  describe('Turnstile', () => {
    const verified = { outcome: 'verified', label: 'web:verified', hostname: 'loamlogger.app' };
    const failed = { outcome: 'failed', reason: 'invalid-input-response', label: 'web:failed:invalid-input-response' };

    it('checks the token with the client IP, stores the verdict and reports it', async () => {
      (evaluateSignupTurnstile as jest.Mock).mockResolvedValue(verified);
      const handler = getHandler('/signup', 'post');
      const req = createMockRequest({ body: { ...body, turnstileToken: 'tok-123' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(evaluateSignupTurnstile).toHaveBeenCalledWith({ token: 'tok-123', remoteIp: '1.2.3.4' });
      expect(createNewUser).toHaveBeenCalledWith(expect.objectContaining({ signupAttestation: 'web:verified' }));
      expect(reportSignupTurnstile).toHaveBeenCalledWith('user_new', verified);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('creates the account in monitor mode even when the token fails', async () => {
      (evaluateSignupTurnstile as jest.Mock).mockResolvedValue(failed);
      const handler = getHandler('/signup', 'post');
      const req = createMockRequest({ body: { ...body, turnstileToken: 'bad' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(checkAuthRateLimit).not.toHaveBeenCalledWith('signup-unverified-web', 'global');
      expect(createNewUser).toHaveBeenCalledWith(
        expect.objectContaining({ signupAttestation: 'web:failed:invalid-input-response' }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('stores no verdict and reports nothing while Turnstile is off', async () => {
      const handler = getHandler('/signup', 'post');
      const req = createMockRequest({ body });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(createNewUser).toHaveBeenCalledWith(expect.objectContaining({ signupAttestation: null }));
      expect(reportSignupTurnstile).not.toHaveBeenCalled();
    });

    it('does not spend the token on a signup that fails validation or hits a taken email', async () => {
      const handler = getHandler('/signup', 'post');

      const res400 = createMockResponse();
      await invokeHandler(
        handler,
        createMockRequest({ body: { ...body, name: '', turnstileToken: 'tok' } }) as Request,
        res400 as unknown as Response,
      );
      expect(res400.status).toHaveBeenCalledWith(400);

      (verifyEmailAvailable as jest.Mock).mockResolvedValue({ available: false });
      const res409 = createMockResponse();
      await invokeHandler(
        handler,
        createMockRequest({ body: { ...body, turnstileToken: 'tok' } }) as Request,
        res409 as unknown as Response,
      );
      expect(res409.status).toHaveBeenCalledWith(409);

      expect(evaluateSignupTurnstile).not.toHaveBeenCalled();
    });

    it('in enforce mode, sends an unverified signup through the global cap and answers 429 when it is full', async () => {
      (evaluateSignupTurnstile as jest.Mock).mockResolvedValue(failed);
      (requiresUnverifiedWebCap as jest.Mock).mockReturnValue(true);
      mockCheckAuthRateLimit.mockImplementation(async (operation: string) =>
        operation === 'signup-unverified-web' ? { allowed: false, retryAfter: 1800 } : { allowed: true },
      );
      const handler = getHandler('/signup', 'post');
      const req = createMockRequest({ body: { ...body, turnstileToken: 'bad' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(checkAuthRateLimit).toHaveBeenCalledWith('signup-unverified-web', 'global');
      expect(res.status).toHaveBeenCalledWith(429);
      expect(createNewUser).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ turnstile: 'web:failed:invalid-input-response', route: 'signup', retryAfter: 1800 }),
        'Web signup 429: unverified cap',
      );
    });

    it('in enforce mode, lets an unverified signup through while the cap has room', async () => {
      (evaluateSignupTurnstile as jest.Mock).mockResolvedValue(failed);
      (requiresUnverifiedWebCap as jest.Mock).mockReturnValue(true);
      const handler = getHandler('/signup', 'post');
      const req = createMockRequest({ body: { ...body, turnstileToken: 'bad' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(checkAuthRateLimit).toHaveBeenCalledWith('signup-unverified-web-ip', '1.2.3.4');
      expect(checkAuthRateLimit).toHaveBeenCalledWith('signup-unverified-web', 'global');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(reportSignupTurnstile).toHaveBeenCalledWith('user_new', failed);
    });

    it('in enforce mode, stops one IP at its share before it can touch the global bucket', async () => {
      (evaluateSignupTurnstile as jest.Mock).mockResolvedValue(failed);
      (requiresUnverifiedWebCap as jest.Mock).mockReturnValue(true);
      mockCheckAuthRateLimit.mockImplementation(async (operation: string) =>
        operation === 'signup-unverified-web-ip' ? { allowed: false, retryAfter: 900 } : { allowed: true },
      );
      const handler = getHandler('/signup', 'post');
      const req = createMockRequest({ body: { ...body, turnstileToken: 'bad' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(checkAuthRateLimit).not.toHaveBeenCalledWith('signup-unverified-web', 'global');
      expect(createNewUser).not.toHaveBeenCalled();
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
      const verifiedAt = new Date('2026-01-01T00:00:00Z');
      mockUserFindUnique.mockResolvedValue({
        id: 'user_1',
        email: 'rider@example.com',
        name: 'Alex',
        emailVerified: verifiedAt,
      });
      mockUserUpdate.mockResolvedValue({});

      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockHashPassword).toHaveBeenCalledWith('NewPass123!');
      // Already verified: the original verification time is left alone.
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

    it('marks an unverified email verified, since the reset link proved the inbox', async () => {
      mockConsumeToken.mockResolvedValue({ ok: true, userId: 'user_1' });
      mockUserFindUnique.mockResolvedValue({
        id: 'user_1',
        email: 'rider@example.com',
        name: 'Alex',
        emailVerified: null,
      });
      mockUserUpdate.mockResolvedValue({});

      const req = createMockRequest({ body: { token: 't', newPassword: 'NewPass123!' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: expect.objectContaining({ emailVerified: expect.any(Date) }),
      });
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

// ============================================================================
// POST /login
// ============================================================================

describe('POST /login', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/login', 'post');
    if (!handler) throw new Error('Handler not found for /login');
  });

  it('returns 429 before looking up the user when the IP is over the limit', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const req = createMockRequest({ body: { email: 'Rider@Example.com', password: 'guess' } });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('login', '1.2.3.4');
    // A blocked IP does not also charge the account's budget.
    expect(mockCheckAuthRateLimit).not.toHaveBeenCalledWith('login-email', expect.anything());
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('returns 429 when the account is over the limit, keyed by a hash of the email', async () => {
    mockCheckAuthRateLimit.mockImplementation(async (operation: string) =>
      operation === 'login-email' ? { allowed: false, retryAfter: 600 } : { allowed: true }
    );
    const req = createMockRequest({ body: { email: 'Rider@Example.com', password: 'guess' } });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(429);
    const emailCall = mockCheckAuthRateLimit.mock.calls.find(([op]) => op === 'login-email');
    expect(emailCall?.[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(emailCall?.[1]).not.toContain('rider');
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('checks both limits and proceeds to the lookup when under them', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const req = createMockRequest({ body: { email: 'rider@example.com', password: 'guess' } });
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('login', '1.2.3.4');
    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('login-email', expect.any(String));
    expect(res.status).toHaveBeenCalledWith(401);
  });

  describe('email verification gate', () => {
    const baseUser = {
      id: 'user_1',
      email: 'rider@example.com',
      name: 'Rider',
      passwordHash: 'hash',
      mustChangePassword: false,
    };

    it('refuses a session to an unverified new signup and resends the link', async () => {
      mockUserFindUnique.mockResolvedValue({ ...baseUser, emailVerificationRequired: true, emailVerified: null });
      const req = createMockRequest({ body: { email: 'rider@example.com', password: 'right' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'EMAIL_VERIFICATION_REQUIRED', details: { email: 'rider@example.com' } }),
      );
      expect(sendVerificationEmailWithinLimit).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user_1' }),
        'user_action',
      );
      expect(issueWebSession).not.toHaveBeenCalled();
    });

    it('answers a wrong password with 401 and sends nothing, so the gate leaks no account state', async () => {
      mockUserFindUnique.mockResolvedValue({ ...baseUser, emailVerificationRequired: true, emailVerified: null });
      (verifyPassword as jest.Mock).mockResolvedValue(false);
      const req = createMockRequest({ body: { email: 'rider@example.com', password: 'wrong' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(sendVerificationEmailWithinLimit).not.toHaveBeenCalled();
    });

    it('signs in a new signup once the email is verified', async () => {
      mockUserFindUnique.mockResolvedValue({
        ...baseUser,
        emailVerificationRequired: true,
        emailVerified: new Date('2026-10-19T00:00:00Z'),
      });
      const req = createMockRequest({ body: { email: 'rider@example.com', password: 'right' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(issueWebSession).toHaveBeenCalledWith(res, { id: 'user_1', email: 'rider@example.com' });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('leaves accounts from before verification shipped ungated', async () => {
      mockUserFindUnique.mockResolvedValue({ ...baseUser, emailVerificationRequired: false, emailVerified: null });
      const req = createMockRequest({ body: { email: 'rider@example.com', password: 'right' } });
      const res = createMockResponse();

      await invokeHandler(handler, req as Request, res as unknown as Response);

      expect(issueWebSession).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(sendVerificationEmailWithinLimit).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// GET /csrf-token
// ============================================================================

describe('GET /csrf-token', () => {
  const handler = getHandler('/csrf-token', 'get');
  const VALID_TOKEN = 'a'.repeat(64);

  it('refuses a request with no session', async () => {
    const req = createMockRequest();
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(setCsrfCookie).not.toHaveBeenCalled();
  });

  it('returns the token the browser already holds without rotating it', async () => {
    const req = createMockRequest({
      sessionUser: { uid: 'user-1' },
      cookies: { ll_csrf: VALID_TOKEN },
    } as Partial<Request>);
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(res.json).toHaveBeenCalledWith({ csrfToken: VALID_TOKEN });
    expect(setCsrfCookie).not.toHaveBeenCalled();
  });

  it('mints a token when the browser has none', async () => {
    const req = createMockRequest({ sessionUser: { uid: 'user-1' } } as Partial<Request>);
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(setCsrfCookie).toHaveBeenCalledWith(res);
    expect(res.json).toHaveBeenCalledWith({ csrfToken: 'csrf_token' });
  });

  it('mints a token rather than echo a malformed cookie', async () => {
    const req = createMockRequest({
      sessionUser: { uid: 'user-1' },
      cookies: { ll_csrf: '<script>' },
    } as Partial<Request>);
    const res = createMockResponse();

    await invokeHandler(handler, req as Request, res as unknown as Response);

    expect(setCsrfCookie).toHaveBeenCalledWith(res);
    expect(res.json).toHaveBeenCalledWith({ csrfToken: 'csrf_token' });
  });
});
