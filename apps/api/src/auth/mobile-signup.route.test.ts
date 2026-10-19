import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockGenerateAccessToken = jest.fn().mockReturnValue('mock-access-token');
const mockGenerateRefreshToken = jest.fn().mockReturnValue('mock-refresh-token');
const mockCheckAuthRateLimit = jest.fn().mockResolvedValue({ allowed: true });
const mockCheckSignupRateLimit = jest.fn().mockResolvedValue({ allowed: true });
const mockSendVerificationEmail = jest.fn().mockResolvedValue(true);
const mockCreateNewUser = jest.fn();
const mockVerifyEmailAvailable = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();
const mockSentryCaptureException = jest.fn();

jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => mockSentryCaptureException(...args),
}));

jest.mock('./appleTokenVerifier', () => ({
  verifyAppleIdentityToken: jest.fn(),
}));

jest.mock('./ensureUserFromApple', () => ({
  ensureUserFromApple: jest.fn(),
}));

jest.mock('./ensureUserFromGoogle', () => ({
  ensureUserFromGoogle: jest.fn(),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

jest.mock('./token', () => ({
  generateAccessToken: (...args: unknown[]) => mockGenerateAccessToken(...args),
  generateRefreshToken: (...args: unknown[]) => mockGenerateRefreshToken(...args),
  verifyToken: jest.fn(),
}));

jest.mock('./recent-auth', () => ({
  updateLastAuthAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./password.utils', () => ({
  validatePassword: jest.fn().mockReturnValue({ isValid: true }),
  hashPassword: jest.fn().mockResolvedValue('hashed-pw'),
  verifyPassword: jest.fn(),
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkSignupRateLimit: (...args: unknown[]) => mockCheckSignupRateLimit(...args),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    // getSessionTokenVersion (via issueMobileTokens) reads this; undefined → version 0.
    user: { findUnique: jest.fn() },
    // issueMobileTokens creates a MobileSession row for every token pair.
    mobileSession: { create: jest.fn().mockResolvedValue({ id: 'session-1' }) },
  },
}));

jest.mock('../lib/logger', () => {
  const auditLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return {
    logger: {
      error: (...args: unknown[]) => mockLoggerError(...args),
      info: (...args: unknown[]) => mockLoggerInfo(...args),
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      debug: (...args: unknown[]) => mockLoggerDebug(...args),
    },
    createLogger: () => auditLogger,
  };
});

jest.mock('../services/password-notification.service', () => ({
  sendPasswordAddedNotification: jest.fn(),
  sendPasswordChangedNotification: jest.fn(),
}));

jest.mock('../config/env', () => ({
  config: { bypassWaitlistFlow: true, appleBundleId: 'com.loamlabs.loamlogger' },
}));

jest.mock('../services/email-verification.service', () => ({
  EMAIL_VERIFICATION_REQUIRED_CODE: 'EMAIL_VERIFICATION_REQUIRED',
  EMAIL_VERIFICATION_REQUIRED_MESSAGE: 'Check your inbox for a link to verify your email, then sign in.',
  isEmailVerificationPending: (u: { emailVerificationRequired: boolean; emailVerified: Date | null }) =>
    u.emailVerificationRequired && !u.emailVerified,
  sendVerificationEmailWithinLimit: (...args: unknown[]) => mockSendVerificationEmail(...args),
}));

jest.mock('../services/signup.service', () => ({
  createNewUser: (...args: unknown[]) => mockCreateNewUser(...args),
  verifyEmailAvailable: (...args: unknown[]) => mockVerifyEmailAvailable(...args),
}));

import router from './mobile.route';
import { prisma } from '../lib/prisma';
import { verifyPassword } from './password.utils';

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

async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
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

describe('POST /mobile/signup', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/mobile/signup', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/signup');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
    mockCheckSignupRateLimit.mockResolvedValue({ allowed: true });
  });

  it('creates the account, emails a link, and answers 403 EMAIL_VERIFICATION_REQUIRED with no tokens', async () => {
    // The 403 is deliberate: app builds that predate verification treat any
    // 2xx as a token response, but show a failed signup's `error` text, so
    // the message is what tells them to check the inbox.
    mockVerifyEmailAvailable.mockResolvedValue({ available: true, email: 'test@example.com' });
    mockCreateNewUser.mockResolvedValue({ user: { id: 'u1', email: 'test@example.com', name: 'Test User' } });

    const req = {
      body: { email: 'test@example.com', password: 'StrongPassw0rd!', name: 'Test User' },
      ip: '127.0.0.1',
      headers: {},
      get: (h: string) => (h.toLowerCase() === 'user-agent' ? 'okhttp/4.12.0' : undefined),
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Check your inbox for a link to verify your email, then sign in.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
      details: { email: 'test@example.com', accountCreated: true },
    });
    expect(mockSendVerificationEmail).toHaveBeenCalledWith(
      { id: 'u1', email: 'test@example.com', name: 'Test User' },
      'user_action',
    );
    expect(mockCreateNewUser).toHaveBeenCalledWith(
      expect.objectContaining({ signupIp: '127.0.0.1', signupUserAgent: 'okhttp/4.12.0' }),
    );
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
    expect(mockGenerateRefreshToken).not.toHaveBeenCalled();
  });

  it('returns 429 from the stacked signup windows before creating anything', async () => {
    mockCheckSignupRateLimit.mockResolvedValue({ allowed: false, retryAfter: 3000 });

    const req = {
      body: { email: 'test@example.com', password: 'StrongPassw0rd!', name: 'Test User' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockCreateNewUser).not.toHaveBeenCalled();
  });

  it('should return 409 when the email is already registered', async () => {
    mockVerifyEmailAvailable.mockResolvedValue({ available: false });

    const req = {
      body: { email: 'taken@example.com', password: 'StrongPassw0rd!', name: 'Test User' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(409);
    // Clients branch on the code, not the wording, to offer log in or reset.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_EXISTS' }));
    expect(mockCreateNewUser).not.toHaveBeenCalled();
  });
});

describe('POST /mobile/login email verification gate', () => {
  let handler: RequestHandler | undefined;
  const mockFindUnique = prisma.user.findUnique as unknown as jest.Mock;
  const mockVerifyPassword = verifyPassword as jest.Mock;

  const baseUser = {
    id: 'u1',
    email: 'rider@example.com',
    passwordHash: 'hash',
    name: 'Rider',
    avatarUrl: null,
  };

  function loginRequest(password = 'right'): Request {
    return {
      body: { email: 'rider@example.com', password },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
  }

  beforeAll(() => {
    handler = getHandler('/mobile/login', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/login');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
    mockVerifyPassword.mockResolvedValue(true);
  });

  it('issues no tokens to an unverified new signup and resends the link', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, emailVerificationRequired: true, emailVerified: null });
    const res = createMockResponse();

    await invokeHandler(handler, loginRequest(), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_VERIFICATION_REQUIRED' }));
    expect(mockSendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'user_action');
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('answers a wrong password with 401 before the gate', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, emailVerificationRequired: true, emailVerified: null });
    mockVerifyPassword.mockResolvedValue(false);
    const res = createMockResponse();

    await invokeHandler(handler, loginRequest('wrong'), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it('issues tokens once the email is verified', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseUser,
      emailVerificationRequired: true,
      emailVerified: new Date('2026-10-19T00:00:00Z'),
    });
    const res = createMockResponse();

    await invokeHandler(handler, loginRequest(), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token' }),
    );
  });

  it('leaves accounts from before verification shipped ungated', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, emailVerificationRequired: false, emailVerified: null });
    const res = createMockResponse();

    await invokeHandler(handler, loginRequest(), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });
});
