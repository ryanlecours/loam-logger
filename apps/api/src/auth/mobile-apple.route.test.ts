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
const mockStartEmailVerification = jest.fn().mockResolvedValue(undefined);

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

jest.mock('../services/signup.service', () => ({
  createNewUser: jest.fn(),
  verifyEmailAvailable: jest.fn(),
}));

jest.mock('../services/email-verification.service', () => ({
  startEmailVerification: (...args: unknown[]) => mockStartEmailVerification(...args),
}));

import router from './mobile.route';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { UnverifiedProviderEmailError } from './account-linking';
import { prisma } from '../lib/prisma';

// The route module builds its Google client at import time. Capture that
// instance now, before any clearAllMocks wipes mock.results.
const googleClient = (OAuth2Client as unknown as jest.Mock).mock.results[0].value as {
  verifyIdToken: jest.Mock;
};
const mockEnsureUserFromGoogle = ensureUserFromGoogle as jest.Mock;
const mockUserFindUnique = prisma.user.findUnique as jest.Mock;

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
    );
  });

  it('sends a verification email for a new account created from the client email', async () => {
    const mockUser = { id: 'u1', email: 'client@user.com', name: null, avatarUrl: null, emailVerified: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({ sub: 'apple-001', email_verified: 'false' });
    mockEnsureUserFromApple.mockResolvedValue({ user: mockUser, wasCreated: true });

    const req = {
      body: { identityToken: 'valid-token', user: { email: 'client@user.com' } },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;

    await invokeHandler(handler, req, createMockResponse() as unknown as Response);

    expect(mockStartEmailVerification).toHaveBeenCalledWith(mockUser);
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
    expect(mockStartEmailVerification).not.toHaveBeenCalled();
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
});

describe('refused provider links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  });

  it('POST /mobile/apple turns a "false" email_verified claim into a 401 refusal', async () => {
    // The string-to-boolean conversion lives in the route, so this is the
    // only place the path from Apple's raw claim to the 401 is covered.
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'rider@example.com',
      email_verified: 'false',
    });
    mockEnsureUserFromApple.mockImplementation(async (claims: { email_verified?: boolean }) => {
      if (!claims.email_verified) throw new UnverifiedProviderEmailError('apple');
      throw new Error('expected email_verified to arrive as false');
    });
    const req = { body: { identityToken: 'valid-token' }, ip: '127.0.0.1', headers: {} } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(getHandler('/mobile/apple', 'post'), req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({ email_verified: false }),
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROVIDER_EMAIL_UNVERIFIED' }),
    );
    expect(mockSentryCaptureException).not.toHaveBeenCalled();
  });

  it('POST /mobile/google answers a refused link with 401, not a 500', async () => {
    googleClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'google-123', email: 'rider@example.com', email_verified: false }),
    });
    mockEnsureUserFromGoogle.mockRejectedValue(new UnverifiedProviderEmailError('google'));
    const req = { body: { idToken: 'valid-token' }, ip: '127.0.0.1', headers: {} } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(getHandler('/mobile/google', 'post'), req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROVIDER_EMAIL_UNVERIFIED' }),
    );
    expect(mockSentryCaptureException).not.toHaveBeenCalled();
  });
});

describe('POST /mobile/login rate limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  });

  it('returns 429 before looking up the user when over the limit', async () => {
    mockCheckAuthRateLimit.mockImplementation(async (operation: string) =>
      operation === 'login' ? { allowed: false, retryAfter: 42 } : { allowed: true }
    );
    const req = {
      body: { email: 'rider@example.com', password: 'guess' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(getHandler('/mobile/login', 'post'), req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
