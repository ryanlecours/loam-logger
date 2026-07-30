import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies before imports
const mockRevokeWhoopTokenForUser = jest.fn();
jest.mock('../lib/whoop-token', () => ({
  revokeWhoopTokenForUser: mockRevokeWhoopTokenForUser,
}));

const mockRandomString = jest.fn();
jest.mock('../lib/pcke', () => ({
  randomString: mockRandomString,
  sha256: jest.fn(),
}));

// Must be mocked: the real module pulls in ./redis, and isRedisReady() would
// return false and silently take the in-memory path, making the 429 untestable.
const mockCheckMutationRateLimit = jest.fn();
jest.mock('../lib/rate-limit', () => ({
  checkMutationRateLimit: (...args: unknown[]) => mockCheckMutationRateLimit(...args),
}));

const mockCreateOAuthAttempt = jest.fn();
const mockConsumeOAuthAttempt = jest.fn();
jest.mock('../lib/oauthState', () => ({
  createOAuthAttempt: (...args: unknown[]) => mockCreateOAuthAttempt(...args),
  consumeOAuthAttempt: (...args: unknown[]) => mockConsumeOAuthAttempt(...args),
}));

const mockFindUnique = jest.fn();
const mockOauthTokenFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  oauthToken: {
    upsert: mockUpsert,
    deleteMany: mockDeleteMany,
    findUnique: mockOauthTokenFindUnique,
  },
  userAccount: {
    upsert: mockUpsert,
    findMany: mockFindMany,
    deleteMany: mockDeleteMany,
  },
  user: {
    findUnique: mockFindUnique,
    update: mockUpdate,
    updateMany: mockUpdateMany,
  },
  $transaction: mockTransaction,
};

jest.mock('../lib/prisma', () => ({
  prisma: mockPrisma,
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../lib/logger', () => ({
  createLogger: jest.fn(() => mockLog),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import router after mocks
import router from './auth.whoop';
import { Prisma } from '@prisma/client';
import { WHOOP_API_BASE } from '../types/whoop';

// Type for Express router layer internals
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

// Helper to get route handler
function getHandler(path: string, method: string): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  return layer?.route?.stack?.[layer.route.stack.length - 1]?.handle;
}

// Helper to invoke handler
async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

describe('auth.whoop routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHOOP_CLIENT_ID = 'test-client-id';
    process.env.WHOOP_CLIENT_SECRET = 'test-client-secret';
    process.env.WHOOP_REDIRECT_URI = 'http://localhost:4000/auth/whoop/callback';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    process.env.NODE_ENV = 'development';
    delete process.env.MOBILE_DEEP_LINK_SCHEME;
    mockCheckMutationRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('GET /whoop/start', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/start', 'get');
      mockRandomString.mockReturnValue('random-state-value');

      mockReq = {};
      mockRes = {
        cookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
    });

    it('should redirect to WHOOP authorization URL', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('https://api.prod.whoop.com/oauth/oauth2/auth')
      );
    });

    it('should set state cookie', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'll_whoop_state',
        'random-state-value',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 600000, // 10 minutes
          path: '/',
        })
      );
    });

    it('should include required OAuth parameters', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const redirectUrl = (mockRes.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('client_id=test-client-id');
      expect(redirectUrl).toContain('redirect_uri=');
      expect(redirectUrl).toContain('response_type=code');
      expect(redirectUrl).toContain('scope=');
      expect(redirectUrl).toContain('state=random-state-value');
    });

    it('should return error if WHOOP_CLIENT_ID is missing', async () => {
      delete process.env.WHOOP_CLIENT_ID;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not configured'),
        })
      );
    });

    it('should return error if WHOOP_REDIRECT_URI is missing', async () => {
      delete process.env.WHOOP_REDIRECT_URI;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /whoop/callback', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/callback', 'get');

      mockReq = {
        query: {
          code: 'auth-code',
          state: 'valid-state',
        },
        cookies: {
          'll_whoop_state': 'valid-state',
        },
        user: { id: 'user-123' },
        sessionUser: undefined,
      };

      mockRes = {
        clearCookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      };

      // Default successful mocks
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
            scope: 'read:workout read:profile offline',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            user_id: 12345,
            email: 'test@example.com',
            first_name: 'Test',
            last_name: 'User',
          }),
        });

      // Default: no DB attempt matches, so every test in this describe block
      // exercises the WEB branch. That is deliberate — these are the regression
      // guard for the pre-mobile behavior and must pass unchanged.
      mockConsumeOAuthAttempt.mockResolvedValue(null);

      mockUpsert.mockResolvedValue({});
      mockUpdate.mockResolvedValue({});
      mockFindMany.mockResolvedValue([{ provider: 'whoop' }]);
      mockFindUnique.mockResolvedValue({ onboardingCompleted: true });
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => {
        await fn(mockPrisma);
      });
    });

    it('should return error for invalid state', async () => {
      mockReq.cookies = { 'll_whoop_state': 'different-state' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid OAuth state',
        })
      );
    });

    it('should return error for missing code', async () => {
      mockReq.query = { state: 'valid-state' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return error for missing user', async () => {
      mockReq.user = undefined;
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('No user'),
        })
      );
    });

    it('should exchange code for tokens', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.prod.whoop.com/oauth/oauth2/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('should fetch user profile', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Asserted against the constant, not a literal — pinning a literal here
      // is exactly how this call stayed on v1 through the rest of the v2 migration.
      expect(mockFetch).toHaveBeenCalledWith(
        `${WHOOP_API_BASE}/user/profile/basic`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer new-access-token' },
        })
      );
      expect(WHOOP_API_BASE).toContain('/developer/v2');
    });

    it('should store tokens in database', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider: { userId: 'user-123', provider: 'whoop' } },
          create: expect.objectContaining({
            userId: 'user-123',
            provider: 'whoop',
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          }),
        })
      );
    });

    it('should redirect to settings on success', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.clearCookie).toHaveBeenCalledWith('ll_whoop_state', { path: '/' });
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/settings?whoop=connected')
      );
    });

    it('should redirect to onboarding if not completed', async () => {
      mockFindUnique.mockResolvedValue({ onboardingCompleted: false });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/onboarding?step=6')
      );
    });

    it('should prompt to choose source when multiple providers connected', async () => {
      mockFindMany.mockResolvedValue([
        { provider: 'whoop' },
        { provider: 'garmin' },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('prompt=choose-source')
      );
    });

    it('should handle token exchange failure', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Token exchange failed'),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('Token exchange failed')
      );
    });

    it('should handle profile fetch failure', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          text: () => Promise.resolve('Profile fetch failed'),
        });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(502);
    });

    it('should use sessionUser if user not available', async () => {
      mockReq.user = undefined;
      mockReq.sessionUser = { uid: 'session-user-456' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider: { userId: 'session-user-456', provider: 'whoop' } },
        })
      );
    });

    it('should redirect with error when WHOOP account is already linked (P2002)', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`whoopUserId`)',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['whoopUserId'] } }
      );
      mockTransaction.mockRejectedValue(p2002Error);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('already%20linked%20to%20another%20user')
      );
    });

    it('should redirect with generic error on non-P2002 database failure', async () => {
      mockTransaction.mockRejectedValue(new Error('Database connection lost'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('WHOOP%20connection%20failed')
      );
    });
  });

  describe('POST /whoop/start (mobile)', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/start', 'post');

      mockReq = { sessionUser: { uid: 'user-123' } } as Partial<Request>;
      mockRes = {
        cookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis(),
      };

      mockCreateOAuthAttempt.mockResolvedValue({
        state: 'db-state-abc',
        verifier: '',
        attempt: { id: 'attempt-1' },
      });
    });

    function authorizeUrl(): URL {
      const call = (mockRes.json as jest.Mock).mock.calls[0][0];
      return new URL(call.data.authorizeUrl);
    }

    it('should return 401 when sessionUser is missing', async () => {
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockCreateOAuthAttempt).not.toHaveBeenCalled();
    });

    it('should NOT fall back to req.user — mobile-only route', async () => {
      mockReq.sessionUser = undefined;
      mockReq.user = { id: 'web-user-999' } as Request['user'];

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockCreateOAuthAttempt).not.toHaveBeenCalled();
    });

    it('should return 429 with Retry-After when rate limited', async () => {
      mockCheckMutationRateLimit.mockResolvedValue({ allowed: false, retryAfter: 120 });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '120');
      expect(mockCreateOAuthAttempt).not.toHaveBeenCalled();
    });

    it.each(['WHOOP_CLIENT_ID', 'WHOOP_REDIRECT_URI'])(
      'should return 500 when %s is missing, without creating an orphan attempt',
      async (envVar) => {
        delete process.env[envVar];

        await invokeHandler(handler, mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockCreateOAuthAttempt).not.toHaveBeenCalled();
      }
    );

    it('should create a MOBILE attempt with no PKCE verifier', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // includeVerifier:false is the guard against someone flipping WHOOP to
      // PKCE — WHOOP authenticates with a client secret, so a stored-but-unsent
      // verifier would be a silent no-op.
      expect(mockCreateOAuthAttempt).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'WHOOP',
        platform: 'MOBILE',
        includeVerifier: false,
      });
    });

    it('should return the authorize URL in the canonical envelope', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        data: {
          authorizeUrl: expect.stringContaining('https://api.prod.whoop.com/oauth/oauth2/auth'),
        },
      });

      const url = authorizeUrl();
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/auth/whoop/callback');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('db-state-abc');
      expect(url.searchParams.get('scope')).toBe('read:workout read:profile offline');
    });

    it('should request the same scope and redirect_uri as the web start route', async () => {
      // A drift in `scope` would drop `offline`, and WHOOP would return no
      // refresh_token — the callback then writes undefined into a non-nullable
      // column, but only on the mobile path. A drift in redirect_uri would break
      // the token exchange, which sends exactly one registered value.
      await invokeHandler(handler, mockReq as Request, mockRes as Response);
      const mobileUrl = authorizeUrl();

      const webHandler = getHandler('/whoop/start', 'get');
      const webRes = { cookie: jest.fn().mockReturnThis(), redirect: jest.fn().mockReturnThis() };
      mockRandomString.mockReturnValue('web-state');
      await invokeHandler(webHandler, {} as Request, webRes as unknown as Response);
      const webUrl = new URL((webRes.redirect as jest.Mock).mock.calls[0][0]);

      expect(mobileUrl.searchParams.get('scope')).toBe(webUrl.searchParams.get('scope'));
      expect(mobileUrl.searchParams.get('redirect_uri')).toBe(webUrl.searchParams.get('redirect_uri'));
    });

    it('should not set a state cookie — the DB row is the only state carrier', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.cookie).not.toHaveBeenCalled();
    });

    it('should return 500 when creating the attempt fails', async () => {
      mockCreateOAuthAttempt.mockRejectedValue(new Error('db down'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /whoop/callback (mobile flow)', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/callback', 'get');

      mockReq = {
        query: { code: 'auth-code', state: 'valid-state' },
        // Neither a cookie nor a session — this is what the external browser
        // actually sends back on mobile.
        cookies: {},
        user: undefined,
        sessionUser: undefined,
      };

      mockRes = {
        clearCookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      };

      mockConsumeOAuthAttempt.mockResolvedValue({
        attempt: { id: 'attempt-1', userId: 'mobile-user-1' },
        verifier: '',
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
            scope: 'read:workout read:profile offline',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            user_id: 12345,
            email: 'test@example.com',
            first_name: 'Test',
            last_name: 'User',
          }),
        });

      mockUpsert.mockResolvedValue({});
      mockUpdate.mockResolvedValue({});
      mockFindMany.mockResolvedValue([{ provider: 'whoop' }]);
      mockFindUnique.mockResolvedValue({ onboardingCompleted: true });
      mockTransaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<void>) => {
        await fn(mockPrisma);
      });
    });

    it('should look up the attempt with the Prisma enum casing', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // oauthState filters on the IntegrationProvider enum — a lowercase
      // value would silently never match.
      expect(mockConsumeOAuthAttempt).toHaveBeenCalledWith({
        state: 'valid-state',
        provider: 'WHOOP',
      });
    });

    it('should redirect to the mobile trampoline on success', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith('/auth/whoop/mobile/complete?status=success');
      expect(mockRes.clearCookie).not.toHaveBeenCalled();
    });

    it('should identify the user from the attempt, not the session', async () => {
      // The whole point of the DB-state flow: this succeeds with no cookie and
      // no session, and the *attempt's* user wins over any stale req.user.
      mockReq.user = { id: 'web-user-999' } as Request['user'];

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider: { userId: 'mobile-user-1', provider: 'whoop' } },
        })
      );
    });

    it('should skip the web-only redirect bookkeeping', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('should deep-link a token exchange failure instead of a 502', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('bad') });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/auth/whoop/mobile/complete?status=error&reason=token_exchange_failed'
      );
      expect(mockRes.status).not.toHaveBeenCalledWith(502);
    });

    it('should report a profile fetch failure as token_exchange_failed', async () => {
      // The app has no profile_fetch_failed message; an unmapped reason would
      // render a generic fallback.
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'a', refresh_token: 'b', expires_in: 3600, token_type: 'bearer', scope: '',
          }),
        })
        .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('nope') });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/auth/whoop/mobile/complete?status=error&reason=token_exchange_failed'
      );
      expect(mockRes.status).not.toHaveBeenCalledWith(502);
    });

    it('should deep-link account_already_linked on P2002', async () => {
      mockTransaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['whoopUserId'] },
        })
      );

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/auth/whoop/mobile/complete?status=error&reason=account_already_linked'
      );
      expect(mockRes.redirect).not.toHaveBeenCalledWith(expect.stringContaining('localhost:5173'));
    });

    it('should deep-link internal_error on a generic failure', async () => {
      mockTransaction.mockRejectedValue(new Error('Database connection lost'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/auth/whoop/mobile/complete?status=error&reason=internal_error'
      );
    });

    it('should deep-link access_denied when the user declines consent', async () => {
      mockReq.query = { error: 'access_denied', state: 'valid-state' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/auth/whoop/mobile/complete?status=error&reason=access_denied'
      );
    });

    it('should leave a declined WEB consent on the legacy 400', async () => {
      mockConsumeOAuthAttempt.mockResolvedValue(null);
      mockReq.query = { error: 'access_denied', state: 'valid-state' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should fall through to the web branch when the attempt is expired or replayed', async () => {
      // Known gap, shared with Strava and Suunto: past the 10-minute TTL the
      // user sees a browser 400 rather than a deep link back into the app.
      mockConsumeOAuthAttempt.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('GET /whoop/mobile/complete', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/mobile/complete', 'get');
      mockReq = { query: {} };
      mockRes = {
        setHeader: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      };
    });

    function body(): string {
      return (mockRes.send as jest.Mock).mock.calls[0][0] as string;
    }

    it('should send uncacheable HTML', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    });

    it('should deep-link to the whoop route the app registers', async () => {
      mockReq.query = { status: 'success' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Path must stay `whoop` — app/oauth/whoop.tsx is what receives this.
      expect(body()).toContain('loamlogger://oauth/whoop?status=success');
    });

    it('should pass a whitelisted reason through', async () => {
      mockReq.query = { status: 'error', reason: 'token_exchange_failed' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(body()).toContain('loamlogger://oauth/whoop?status=error&amp;reason=token_exchange_failed');
    });

    it('should drop a non-whitelisted reason', async () => {
      mockReq.query = { status: 'error', reason: '<script>alert(1)</script>' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(body()).not.toContain('<script>alert');
      expect(body()).not.toContain('reason=');
    });

    it('should coerce an unknown status to error', async () => {
      mockReq.query = { status: 'bogus' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(body()).toContain('loamlogger://oauth/whoop?status=error');
    });

    it('should honour MOBILE_DEEP_LINK_SCHEME', async () => {
      process.env.MOBILE_DEEP_LINK_SCHEME = 'llstaging';
      mockReq.query = { status: 'success' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(body()).toContain('llstaging://oauth/whoop?status=success');
    });
  });

  describe('DELETE /whoop/disconnect', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/disconnect', 'delete');

      mockReq = {
        user: { id: 'user-123' },
        sessionUser: undefined,
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      mockRevokeWhoopTokenForUser.mockResolvedValue(true);
      mockTransaction.mockResolvedValue(undefined);
    });

    it('should return error if not authenticated', async () => {
      mockReq.user = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Not authenticated',
        })
      );
    });

    it('should revoke token with WHOOP', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRevokeWhoopTokenForUser).toHaveBeenCalledWith('user-123');
    });

    it('should delete tokens and accounts from database', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should not pre-read activeDataSource (no TOCTOU window)', async () => {
      // The pre-refactor code did a `user.findUnique({ select: activeDataSource })`
      // outside the transaction, then conditionally cleared inside — the
      // window between read and write was a race against concurrent updates
      // from another device. The new code uses a SQL-level conditional
      // updateMany instead. Pin that the read is gone so a future
      // contributor can't quietly reintroduce the race.
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('should return success response', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Standardized envelope shape (sendSuccess) — same shape POST and
      // DELETE return so callers get a single contract.
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should proceed even if token revocation fails', async () => {
      mockRevokeWhoopTokenForUser.mockResolvedValue(false);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should issue a SQL-conditional updateMany to clear activeDataSource only if it still equals whoop', async () => {
      // Stronger than the pre-refactor "include clearing activeDataSource"
      // assertion: pins the exact `where` shape of the conditional update.
      // If a future contributor drops `activeDataSource: 'whoop'` from the
      // where clause, the update would clobber a value another device just
      // wrote — re-introducing the TOCTOU bug this fix eliminated.
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'user-123', activeDataSource: 'whoop' },
        data: { activeDataSource: null },
      });
      // The unconditional clear of whoopUserId is a separate update, scoped
      // to the user by primary key only — that one always runs.
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { whoopUserId: null },
      });
    });

    it('should handle database errors gracefully', async () => {
      mockTransaction.mockRejectedValue(new Error('Database error'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Failed to disconnect',
        })
      );
    });

    it('should use sessionUser if user not available', async () => {
      mockReq.user = undefined;
      mockReq.sessionUser = { uid: 'session-user-789' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRevokeWhoopTokenForUser).toHaveBeenCalledWith('session-user-789');
    });
  });

  describe('GET /whoop/status', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/status', 'get');

      // Mobile-only route — caller is identified via sessionUser (bearer
      // token), not req.user (web cookie). See comment in auth.whoop.ts.
      mockReq = {
        user: undefined,
        sessionUser: { uid: 'user-123' },
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
    });

    it('should return connected: true when an oauth token exists', async () => {
      const createdAt = new Date('2026-04-01T10:00:00.000Z');
      mockOauthTokenFindUnique.mockResolvedValue({ createdAt });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Pinned to assert that `select` scopes the read to `createdAt` only —
      // dropping the select would silently start pulling accessToken /
      // refreshToken into memory on every status check.
      expect(mockOauthTokenFindUnique).toHaveBeenCalledWith({
        where: { userId_provider: { userId: 'user-123', provider: 'whoop' } },
        select: { createdAt: true },
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      // Payload is intentionally narrower than the Suunto/Garmin/Strava
      // status shape — WHOOP's OauthToken row has no revokedAt/lastSyncAt/
      // scopes columns, so we omit those fields rather than emit
      // hardcoded nulls. Pinned by exact-shape assertion so a future
      // contributor can't quietly re-add misleading null placeholders.
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        data: {
          connected: true,
          connectedAt: createdAt.toISOString(),
        },
      });
    });

    it('should return connected: false when no oauth token exists', async () => {
      mockOauthTokenFindUnique.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          data: { connected: false },
        }),
      );
    });

    it('should return 401 when sessionUser is missing', async () => {
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockOauthTokenFindUnique).not.toHaveBeenCalled();
    });

    it('should NOT fall back to req.user — mobile-only route', async () => {
      // The auth-strategy comment in auth.whoop.ts explicitly documents that
      // status is a mobile-only surface. Setting only `req.user` (web cookie
      // path) without `sessionUser` (mobile bearer path) should fail auth,
      // not silently succeed via the fallback we use on DELETE.
      mockReq.user = { id: 'web-user-456' };
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockOauthTokenFindUnique).not.toHaveBeenCalled();
    });

    it('should return 500 when the database query fails', async () => {
      mockOauthTokenFindUnique.mockRejectedValue(new Error('DB down'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /whoop/disconnect', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      handler = getHandler('/whoop/disconnect', 'post');

      // Mobile-only route — same auth-strategy split as GET /whoop/status.
      mockReq = {
        user: undefined,
        sessionUser: { uid: 'user-123' },
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      mockRevokeWhoopTokenForUser.mockResolvedValue(true);
      mockTransaction.mockResolvedValue(undefined);
    });

    it('should return 401 when sessionUser is missing', async () => {
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRevokeWhoopTokenForUser).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should NOT fall back to req.user — mobile-only route', async () => {
      mockReq.user = { id: 'web-user-456' };
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRevokeWhoopTokenForUser).not.toHaveBeenCalled();
    });

    it('should revoke and disconnect, returning the canonical envelope', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRevokeWhoopTokenForUser).toHaveBeenCalledWith('user-123');
      expect(mockTransaction).toHaveBeenCalled();
      // Same `{ ok: true }` envelope as DELETE — single contract for both
      // verbs, asserted on the response shape, not the HTTP method.
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should warn and proceed when token revocation fails', async () => {
      mockRevokeWhoopTokenForUser.mockResolvedValue(false);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Warn captured by the shared handleWhoopDisconnect helper, then
      // local cleanup proceeds and the response is still success.
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' }),
        expect.stringContaining('WHOOP token revocation failed'),
      );
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should return 500 when the disconnect transaction fails', async () => {
      mockTransaction.mockRejectedValue(new Error('Database error'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Failed to disconnect' }),
      );
    });
  });
});
