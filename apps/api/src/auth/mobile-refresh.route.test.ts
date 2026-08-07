import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies BEFORE importing the router
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  createLogger: () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

jest.mock('./ensureUserFromGoogle', () => ({ ensureUserFromGoogle: jest.fn() }));
jest.mock('./ensureUserFromApple', () => ({ ensureUserFromApple: jest.fn() }));
jest.mock('./appleTokenVerifier', () => ({ verifyAppleIdentityToken: jest.fn() }));

jest.mock('./token', () => ({
  // Real isRefreshTokenPayload/isAccessTokenPayload: the tests below feed
  // realistically-shaped payloads through the actual type predicates, so a
  // regression in that logic fails here, not just in token.test.ts.
  ...jest.requireActual('./token'),
  generateAccessToken: jest.fn().mockReturnValue('new_access_token'),
  generateRefreshToken: jest.fn().mockReturnValue('new_refresh_token'),
  verifyToken: jest.fn(),
}));

jest.mock('./session-issuer', () => ({
  issueMobileTokens: jest.fn(),
}));

jest.mock('./mobile-session', () => ({
  // Real hashLegacyToken so tests can compute the same hash the route does.
  ...jest.requireActual('./mobile-session'),
  rotateMobileSession: jest.fn(),
  revokeMobileSession: jest.fn(),
  upgradeLegacySession: jest.fn(),
}));

jest.mock('./recent-auth', () => ({
  updateLastAuthAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/password-notification.service', () => ({
  sendPasswordAddedNotification: jest.fn(),
  sendPasswordChangedNotification: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import router from './mobile.route';
import { prisma } from '../lib/prisma';
import { generateRefreshToken, verifyToken } from './token';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { rotateMobileSession, revokeMobileSession, upgradeLegacySession, hashLegacyToken } from './mobile-session';

const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockVerifyToken = verifyToken as jest.Mock;
const mockGenerateRefreshToken = generateRefreshToken as jest.Mock;
const mockCheckAuthRateLimit = checkAuthRateLimit as jest.Mock;
const mockUpgradeLegacySession = upgradeLegacySession as jest.Mock;
const mockRotateMobileSession = rotateMobileSession as jest.Mock;
const mockRevokeMobileSession = revokeMobileSession as jest.Mock;

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

function createMockResponse(): Partial<Response> & { status: jest.Mock; json: jest.Mock; send: jest.Mock; setHeader: jest.Mock } {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

const USER = { id: 'user-1', email: 'rider@example.com', sessionTokenVersion: 0 };

describe('POST /mobile/refresh', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/mobile/refresh', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/refresh');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue(USER);
    mockGenerateRefreshToken.mockReturnValue('new_refresh_token');
  });

  it('rotates a session-bound token and returns the new pair', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', email: USER.email, v: 0, typ: 'refresh', sid: 'sid-1', jti: 'jti-1' });
    mockRotateMobileSession.mockResolvedValue({ ok: true, jti: 'jti-2' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(mockRotateMobileSession).toHaveBeenCalledWith('sid-1', 'jti-1');
    expect(mockGenerateRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1', sid: 'sid-1', jti: 'jti-2' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'new_access_token',
      refreshToken: 'new_refresh_token',
    });
  });

  it('returns 401 and reports the stolen-chain signature when a spent token is replayed', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, typ: 'refresh', sid: 'sid-1', jti: 'jti-stolen' });
    mockRotateMobileSession.mockResolvedValue({ ok: false, reason: 'reuse-detected', detail: 'spent-previous' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Mobile refresh token reuse detected (spent token replayed)',
      expect.anything()
    );
  });

  it('reports an unknown jti under its own signal, distinct from spent-token replay', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, typ: 'refresh', sid: 'sid-1', jti: 'jti-mystery' });
    mockRotateMobileSession.mockResolvedValue({ ok: false, reason: 'reuse-detected', detail: 'unknown-jti' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Mobile refresh token with unknown jti (client token corruption or theft)',
      expect.anything()
    );
  });

  it('returns 401 for a revoked session without Sentry noise', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, typ: 'refresh', sid: 'sid-1', jti: 'jti-1' });
    mockRotateMobileSession.mockResolvedValue({ ok: false, reason: 'revoked' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('upgrades a legacy sid-less token to a session, keyed by the token hash', async () => {
    const iat = Math.floor(Date.now() / 1000);
    mockVerifyToken.mockReturnValue({ uid: 'user-1', email: USER.email, v: 0, iat, exp: iat + 7 * 24 * 60 * 60 });
    mockUpgradeLegacySession.mockResolvedValue({ ok: true, sid: 'sid-new', jti: 'jti-new' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'legacy' } } as Request, res as Response);

    expect(mockUpgradeLegacySession).toHaveBeenCalledWith('user-1', hashLegacyToken('legacy'));
    expect(mockRotateMobileSession).not.toHaveBeenCalled();
    expect(mockGenerateRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sid: 'sid-new', jti: 'jti-new' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 401 and reports when a legacy token is replayed after its upgrade', async () => {
    const iat = Math.floor(Date.now() / 1000);
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, iat, exp: iat + 7 * 24 * 60 * 60 });
    mockUpgradeLegacySession.mockResolvedValue({ ok: false, reason: 'reuse-detected' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'legacy-replayed' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Mobile legacy refresh token replayed after upgrade',
      expect.anything()
    );
  });

  it('returns 429 when the per-user refresh rate limit trips, before any DB work', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, typ: 'refresh', sid: 'sid-1', jti: 'jti-1' });
    mockCheckAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('token-refresh', 'user-1');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockRotateMobileSession).not.toHaveBeenCalled();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('still rejects tokens invalidated by a sessionTokenVersion bump', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, typ: 'refresh', sid: 'sid-1', jti: 'jti-1' });
    mockUserFindUnique.mockResolvedValue({ ...USER, sessionTokenVersion: 1 });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRotateMobileSession).not.toHaveBeenCalled();
  });

  it('returns 401 for an unverifiable token', async () => {
    mockVerifyToken.mockReturnValue(null);
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'garbage' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // Access tokens verify with the same secret and, like legacy refresh
  // tokens, carry no sid/jti. Without the typ gate, a leaked 15-minute
  // access token POSTed here would be upgraded into a 365-day session.
  it('refuses to upgrade an access token into a refresh session', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', email: USER.email, v: 0, typ: 'access' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'an-access-token' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpgradeLegacySession).not.toHaveBeenCalled();
    expect(mockRotateMobileSession).not.toHaveBeenCalled();
  });

  it('refuses a legacy-shaped token whose signed lifetime says access token', async () => {
    const iat = Math.floor(Date.now() / 1000);
    mockVerifyToken.mockReturnValue({ uid: 'user-1', v: 0, iat, exp: iat + 15 * 60 });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'legacy-access' } } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUpgradeLegacySession).not.toHaveBeenCalled();
  });
});

describe('POST /mobile/logout', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/mobile/logout', 'post');
    if (!handler) throw new Error('Handler not found for /mobile/logout');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes the session named by a valid token', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', typ: 'refresh', sid: 'sid-1', jti: 'jti-1' });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(mockRevokeMobileSession).toHaveBeenCalledWith('sid-1', 'user-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('succeeds without revoking when the token is expired or malformed', async () => {
    mockVerifyToken.mockReturnValue(null);
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'expired' } } as Request, res as Response);

    expect(mockRevokeMobileSession).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 400 when the refresh token is missing', async () => {
    const res = createMockResponse();

    await invokeHandler(handler, { body: {} } as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 429 when the per-user logout rate limit trips, without revoking', async () => {
    mockVerifyToken.mockReturnValue({ uid: 'user-1', typ: 'refresh', sid: 'sid-1', jti: 'jti-1' });
    mockCheckAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
    const res = createMockResponse();

    await invokeHandler(handler, { body: { refreshToken: 'rt' } } as Request, res as Response);

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('token-logout', 'user-1');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockRevokeMobileSession).not.toHaveBeenCalled();
  });
});
