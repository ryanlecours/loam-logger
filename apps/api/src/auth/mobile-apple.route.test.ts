import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockVerifyAppleIdentityToken = jest.fn();
const mockEnsureUserFromApple = jest.fn();
const mockGenerateAccessToken = jest.fn().mockReturnValue('mock-access-token');
const mockGenerateRefreshToken = jest.fn().mockReturnValue('mock-refresh-token');
const mockUpdateLastAuthAt = jest.fn().mockResolvedValue(undefined);
const mockCheckAuthRateLimit = jest.fn().mockResolvedValue({ allowed: true });

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

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../services/password-notification.service', () => ({
  sendPasswordAddedNotification: jest.fn(),
  sendPasswordChangedNotification: jest.fn(),
}));

jest.mock('../config/env', () => ({
  config: { bypassWaitlistFlow: true },
}));

jest.mock('../services/signup.service', () => ({
  createNewUser: jest.fn(),
  verifyEmailAvailable: jest.fn(),
}));

// Set env before importing router
process.env.APPLE_BUNDLE_ID = 'com.loamlabs.loamlogger';

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
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
  });

  it('should return 400 when identityToken is missing', async () => {
    const req = { body: {}, ip: '127.0.0.1', headers: {} } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Missing identityToken');
  });

  it('should return 429 when rate limited', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
    const req = { body: { identityToken: 'token' }, ip: '127.0.0.1', headers: {} } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('should assemble fullName from givenName and familyName', async () => {
    const mockUser = { id: 'u1', email: 'jane@example.com', name: 'Jane Doe', avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'jane@example.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

    const req = {
      body: {
        identityToken: 'valid-token',
        fullName: { givenName: 'Jane', familyName: 'Doe' },
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

  it('should handle givenName only', async () => {
    const mockUser = { id: 'u1', email: 'j@example.com', name: 'Jane', avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'j@example.com',
      email_verified: 'false',
    });
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

    const req = {
      body: {
        identityToken: 'valid-token',
        fullName: { givenName: 'Jane', familyName: null },
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
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

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

  it('should prefer token email over client-provided email', async () => {
    const mockUser = { id: 'u1', email: 'token@apple.com', name: null, avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email: 'token@apple.com',
      email_verified: 'true',
    });
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

    const req = {
      body: { identityToken: 'valid-token', email: 'client@user.com' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'token@apple.com' }),
      undefined,
    );
  });

  it('should fall back to client email when token has none', async () => {
    const mockUser = { id: 'u1', email: 'client@user.com', name: null, avatarUrl: null };
    mockVerifyAppleIdentityToken.mockResolvedValue({
      sub: 'apple-001',
      email_verified: 'false',
    });
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

    const req = {
      body: { identityToken: 'valid-token', email: 'client@user.com' },
      ip: '127.0.0.1',
      headers: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockEnsureUserFromApple).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'client@user.com' }),
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
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

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
    mockEnsureUserFromApple.mockResolvedValue(mockUser);

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

  it('should return 403 for CLOSED_BETA error', async () => {
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
    expect(res.send).toHaveBeenCalledWith('CLOSED_BETA');
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
    expect(res.send).toHaveBeenCalledWith('ALREADY_ON_WAITLIST');
  });
});
