import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockVerifyIdToken = jest.fn();
const mockEnsureUserFromGoogle = jest.fn();
const mockIssueWebSession = jest.fn().mockResolvedValue(undefined);
const mockLoggerError = jest.fn();
const mockCheckAuthRateLimit = jest.fn();
const mockStartEmailVerification = jest.fn().mockResolvedValue(undefined);

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
}));
jest.mock('../services/email-verification.service', () => ({
  startEmailVerification: (...args: unknown[]) => mockStartEmailVerification(...args),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  })),
}));

jest.mock('./ensureUserFromGoogle', () => ({
  ensureUserFromGoogle: (...args: unknown[]) => mockEnsureUserFromGoogle(...args),
}));

jest.mock('./session', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('./session-issuer', () => ({
  issueWebSession: (...args: unknown[]) => mockIssueWebSession(...args),
}));
jest.mock('./csrf', () => ({
  setCsrfCookie: jest.fn().mockReturnValue('csrf_token'),
  clearCsrfCookie: jest.fn(),
}));
jest.mock('./recent-auth', () => ({
  updateLastAuthAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/logger', () => {
  const audit = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return {
    logger: {
      error: (...args: unknown[]) => mockLoggerError(...args),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    createLogger: () => audit,
  };
});

import router from './google.route';
import { UnverifiedProviderEmailError, UNVERIFIED_PROVIDER_EMAIL_MESSAGE } from './account-linking';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  const handlers = layer?.route?.stack;
  const handler = handlers?.[handlers.length - 1]?.handle;
  if (!handler) throw new Error(`Handler not found for ${path}`);
  return handler;
}

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

describe('POST /google/code', () => {
  const handler = getHandler('/google/code', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: 'google-123', email: 'rider@example.com', email_verified: false }),
    });
  });

  it('answers a refused link with 401 and the verify message, without a session', async () => {
    mockEnsureUserFromGoogle.mockRejectedValue(new UnverifiedProviderEmailError('google'));
    const req = { body: { credential: 'id-token' } } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res as unknown as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith(UNVERIFIED_PROVIDER_EMAIL_MESSAGE);
    expect(mockIssueWebSession).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('answers 429 before verifying the token when the IP is over the limit', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const req = { body: { credential: 'id-token' }, ip: '1.2.3.4' } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res as unknown as Response, jest.fn() as NextFunction);

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('oauth-login', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('sends a verification email when it creates an account Google has not verified', async () => {
    const user = { id: 'u1', email: 'rider@example.com', emailVerified: null };
    mockEnsureUserFromGoogle.mockResolvedValue({ user, wasCreated: true });
    const req = { body: { credential: 'id-token' } } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res as unknown as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStartEmailVerification).toHaveBeenCalledWith(user);
  });

  it('sends nothing for a verified or existing account', async () => {
    const verified = { id: 'u1', email: 'rider@example.com', emailVerified: new Date() };
    mockEnsureUserFromGoogle.mockResolvedValueOnce({ user: verified, wasCreated: true });
    mockEnsureUserFromGoogle.mockResolvedValueOnce({
      user: { ...verified, emailVerified: null },
      wasCreated: false,
    });
    const req = { body: { credential: 'id-token' } } as unknown as Request;

    await handler(req, createMockResponse() as unknown as Response, jest.fn() as NextFunction);
    await handler(req, createMockResponse() as unknown as Response, jest.fn() as NextFunction);

    expect(mockStartEmailVerification).not.toHaveBeenCalled();
  });

  it('still answers other failures with 500', async () => {
    mockEnsureUserFromGoogle.mockRejectedValue(new Error('db down'));
    const req = { body: { credential: 'id-token' } } as unknown as Request;
    const res = createMockResponse();

    await handler(req, res as unknown as Response, jest.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockIssueWebSession).not.toHaveBeenCalled();
  });
});
