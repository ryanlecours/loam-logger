import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockGenerateAccessToken = jest.fn().mockReturnValue('mock-access-token');
const mockGenerateRefreshToken = jest.fn().mockReturnValue('mock-refresh-token');
const mockCheckAuthRateLimit = jest.fn().mockResolvedValue({ allowed: true });
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
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    // getSessionTokenVersion (via issueMobileTokens) reads this; undefined → version 0.
    user: { findUnique: jest.fn() },
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

jest.mock('../services/signup.service', () => ({
  createNewUser: (...args: unknown[]) => mockCreateNewUser(...args),
  verifyEmailAvailable: (...args: unknown[]) => mockVerifyEmailAvailable(...args),
}));

import router from './mobile.route';

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
  });

  it('should return 201 with tokens AND a user object on success', async () => {
    // Regression guard: the signup response previously omitted `user`, which made
    // the mobile client store `undefined` in SecureStore and crash. All mobile auth
    // routes must return `user: { id, email, name, avatarUrl }`.
    mockVerifyEmailAvailable.mockResolvedValue({ available: true, email: 'test@example.com' });
    mockCreateNewUser.mockResolvedValue({ user: { id: 'u1', email: 'test@example.com' } });

    const req = {
      body: { email: 'test@example.com', password: 'StrongPassw0rd!', name: 'Test User' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: null,
      },
    });
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
    expect(mockCreateNewUser).not.toHaveBeenCalled();
  });
});
