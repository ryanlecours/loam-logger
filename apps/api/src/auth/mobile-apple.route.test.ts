import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockVerifyAppleIdentityToken = jest.fn();
const mockEnsureUserFromApple = jest.fn();
const mockGenerateAccessToken = jest.fn().mockReturnValue('mock-access-token');
const mockGenerateRefreshToken = jest.fn().mockReturnValue('mock-refresh-token');
const mockUpdateLastAuthAt = jest.fn().mockResolvedValue(undefined);
const mockCheckAuthRateLimit = jest.fn().mockResolvedValue({ allowed: true });
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();
const mockSentryCaptureException = jest.fn();

jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => mockSentryCaptureException(...args),
}));

jest.mock('./appleTokenVerifier', () => ({
  verifyAppleIdentityToken: (...args: unknown[]) => mockVerifyAppleIdentityToken(...args),
}));

jest.mock('./ensureUserFromApple', () => ({
  ensureUserFromApple: (...args: unknown[]) => mockEnsureUserFromApple(...args),
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
  updateLastAuthAt: (...args: unknown[]) => mockUpdateLastAuthAt(...args),
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
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
  createNewUser: jest.fn(),
  verifyEmailAvailable: jest.fn(),
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

describe('POST /mobile/apple', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/mobile/apple', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/apple');
  });

  beforeEach(() => {
    // clearAllMocks already resets every jest.fn() in the registry, including
    // the logger / Sentry mocks. Only restore the rate-limit default after.
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  });

  it('should return 400 when identityToken is missing', async () => {
    const req = { body: {}, ip: '127.0.0.1', headers: {} } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing identityToken', code: 'MISSING_TOKEN' });
  });

  it('should return 429 when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
    const req = { body: { identityToken: 'token' }, ip: '127.0.0.1', headers: {} } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('should assemble name from firstName and lastName', async () => {
    const mockUser = { id: 'u1', email: 'jane@example.com', name: 'Jane Doe', avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'jane@example.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: {
        identityToken: 'valid-token',
        user: { name: { firstName: 'Jane', lastName: 'Doe' } },
      },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jane Doe' }),
      undefined,
    );
  });

  it('should handle firstName only', async () => {
    const mockUser = { id: 'u1', email: 'j@example.com', name: 'Jane', avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'j@example.com',
      email_verified: 'false',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: {
        identityToken: 'valid-token',
        user: { name: { firstName: 'Jane' } },
      },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jane' }),
      undefined,
    );
  });

  it('should convert email_verified string to boolean', async () => {
    const mockUser = { id: 'u1', email: 'a@b.com', name: null, avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'a@b.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: { identityToken: 'valid-token' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({ email_verified: true }),
      undefined,
    );
  });

  it('should pass token email as trusted and client email separately', async () => {
    const mockUser = { id: 'u1', email: 'token@apple.com', name: null, avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'token@apple.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: { identityToken: 'valid-token', user: { email: 'client@user.com' } },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'token@apple.com',
        clientEmail: 'client@user.com',
      }),
      undefined,
    );
  });

  it('should pass clientEmail when token has no email', async () => {
    const mockUser = { id: 'u1', email: 'client@user.com', name: null, avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email_verified: 'false',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: { identityToken: 'valid-token', user: { email: 'client@user.com' } },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({
        email: undefined,
        clientEmail: 'client@user.com',
      }),
      undefined,
    );
  });

  it('should pass ref to ensureUserFromApple', async () => {
    const mockUser = { id: 'u1', email: 'a@b.com', name: null, avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'a@b.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: { identityToken: 'valid-token', ref: 'abc123' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.any(Object),
      'abc123',
    );
  });

  it('should return tokens and user on success', async () => {
    const mockUser = { id: 'u1', email: 'jane@example.com', name: 'Jane Doe', avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'jane@example.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: false });

    const req = {
      body: { identityToken: 'valid-token' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: {
        id: 'u1',
        email: 'jane@example.com',
        name: 'Jane Doe',
        avatarUrl: null,
      },
    });
    expect(mockUpdateLastAuthAt).toHaveBeenCalledWith('u1');
  });

  it('should return 403 for CLOSED_BETA error and log it with sub', async () => {
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'new@user.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockRejectedValue(new Error('CLOSED_BETA'));

    const req = {
      body: { identityToken: 'valid-token' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CLOSED_BETA', code: 'CLOSED_BETA' });
    // Anchor assertion: gate hits are logged at info level with the apple sub
    // and the closed-beta discriminator so Railway can filter to them.
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CLOSED_BETA', sub: 'apple-001' }),
      expect.any(String)
    );
  });

  it('should return 401 when Apple token verification fails and log the reason', async () => {
    const verifyErr = new Error('audience mismatch') as Error & { _apple?: { reason: string; claim?: unknown } };
    verifyErr._apple = { reason: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' };
    mockVerifyAppleIdentityToken.mockRejectedValue(verifyErr);

    const req = {
      body: { identityToken: 'forged-token' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    // Anchor assertion: token-verify failures emit a warn-level log with the
    // jose error discriminator so the failure mode is debuggable from Railway alone.
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' }),
      expect.stringMatching(/token verification failed/i)
    );
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('should return 403 for ALREADY_ON_WAITLIST error', async () => {
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'wait@user.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockRejectedValue(new Error('ALREADY_ON_WAITLIST'));

    const req = {
      body: { identityToken: 'valid-token' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'ALREADY_ON_WAITLIST', code: 'ALREADY_ON_WAITLIST' });
  });
});
