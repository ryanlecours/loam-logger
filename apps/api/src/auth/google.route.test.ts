import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockVerifyIdToken = jest.fn();
const mockEnsureUserFromGoogle = jest.fn();
const mockIssueWebSession = jest.fn().mockResolvedValue(undefined);
const mockLoggerError = jest.fn();

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
import {
  ProviderLinkNeedsPasswordError,
  UnverifiedProviderEmailError,
  UNVERIFIED_PROVIDER_EMAIL_MESSAGE,
} from './account-linking';
import { verifyProviderLinkToken } from './provider-link';

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
  };
}

describe('POST /google/code', () => {
  const handler = getHandler('/google/code', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('answers a held link with 409 and a link token, without a session', async () => {
    const savedSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-secret';
    try {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: 'google-123', email: 'rider@example.com', email_verified: true }),
      });
      mockEnsureUserFromGoogle.mockRejectedValue(
        new ProviderLinkNeedsPasswordError('google', 'legacy', 'rider@example.com')
      );
      const req = { body: { credential: 'id-token' } } as unknown as Request;
      const res = createMockResponse();

      await handler(req, res as unknown as Response, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body).toMatchObject({ code: 'LINK_NEEDS_PASSWORD', details: { email: 'rider@example.com' } });
      expect(verifyProviderLinkToken(body.details.linkToken)).toMatchObject({ sub: 'google-123', userId: 'legacy' });
      expect(mockIssueWebSession).not.toHaveBeenCalled();
    } finally {
      process.env.SESSION_SECRET = savedSecret;
    }
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
