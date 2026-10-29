import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Covers the Strava callback's flow detection and its post-connect redirect.
// The happy-path token storage is exercised through the same handler but is
// not what these tests pin; see auth.whoop.test.ts for that shape.

jest.mock('../lib/strava-token', () => ({
  revokeStravaTokenForUser: jest.fn(),
}));

jest.mock('../lib/pcke', () => ({
  randomString: jest.fn(() => 'web-state'),
  sha256: jest.fn(),
}));

jest.mock('../lib/rate-limit', () => ({
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('../lib/crypto', () => ({
  encrypt: jest.fn((value: string) => `enc:${value}`),
}));

const mockConsumeOAuthAttempt = jest.fn();
const mockFindOAuthAttemptOwner = jest.fn();
jest.mock('../lib/oauthState', () => ({
  createOAuthAttempt: jest.fn(),
  consumeOAuthAttempt: (...args: unknown[]) => mockConsumeOAuthAttempt(...args),
  findOAuthAttemptOwner: (...args: unknown[]) => mockFindOAuthAttemptOwner(...args),
  isMobileOAuthState: jest.requireActual('../lib/oauthState').isMobileOAuthState,
}));

const mockShouldPromptForDataSource = jest.fn();
jest.mock('../lib/data-source-prompt', () => ({
  shouldPromptForDataSource: (...args: unknown[]) => mockShouldPromptForDataSource(...args),
}));

const mockCaptureProviderConnectFailed = jest.fn();
jest.mock('../lib/posthog', () => ({
  captureProviderConnected: jest.fn(),
  captureProviderConnectStarted: jest.fn(),
  captureProviderConnectFailed: (...args: unknown[]) => mockCaptureProviderConnectFailed(...args),
  captureProviderDisconnected: jest.fn(),
}));

jest.mock('../lib/auto-import', () => ({
  startAutoImport: jest.fn().mockResolvedValue({ status: 'queued', jobId: 'job-1' }),
}));

const mockUserFindUnique = jest.fn();
const mockPrisma = {
  oauthToken: { upsert: jest.fn().mockResolvedValue({}) },
  userAccount: { upsert: jest.fn().mockResolvedValue({}) },
  userIntegration: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  },
  user: { findUnique: mockUserFindUnique, update: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(mockPrisma)),
};
jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../lib/logger', () => ({ createLogger: jest.fn(() => mockLog) }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import router from './auth.strava';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
  const handler = layer?.route?.stack?.[layer.route.stack.length - 1]?.handle;
  if (!handler) throw new Error(`Handler not found: ${method} ${path}`);
  return handler;
}

function makeRes(): Response {
  return {
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function tokenResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'Bearer',
      athlete: { id: 42 },
    }),
  };
}

describe('GET /strava/callback', () => {
  const handler = getHandler('/strava/callback', 'get');
  let res: Response;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRAVA_CLIENT_ID = 'client-id';
    process.env.STRAVA_CLIENT_SECRET = 'client-secret';
    process.env.STRAVA_REDIRECT_URI = 'http://localhost:4000/auth/strava/callback';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    res = makeRes();
    mockConsumeOAuthAttempt.mockResolvedValue(null);
    mockShouldPromptForDataSource.mockResolvedValue(false);
    mockUserFindUnique.mockResolvedValue({ onboardingCompleted: true });
    mockFetch.mockResolvedValue(tokenResponse());
  });

  describe('expired or replayed mobile attempt (loam-logger#267)', () => {
    const req = {
      query: { code: 'auth-code', state: 'm.expired' },
      // What the system browser actually sends back: no cookie, no session.
      cookies: {},
      user: undefined,
      sessionUser: undefined,
    } as unknown as Request;

    it('deep-links back into the app with invalid_state', async () => {
      mockFindOAuthAttemptOwner.mockResolvedValue('mobile-user-1');

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/strava/mobile/complete?status=error&reason=invalid_state'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('attributes the failure to the attempt owner when the row still exists', async () => {
      mockFindOAuthAttemptOwner.mockResolvedValue('mobile-user-1');

      await handler(req, res, jest.fn() as NextFunction);

      expect(mockFindOAuthAttemptOwner).toHaveBeenCalledWith({ state: 'm.expired', provider: 'STRAVA' });
      expect(mockCaptureProviderConnectFailed).toHaveBeenCalledWith(
        'mobile-user-1',
        'strava',
        'invalid_state',
        { isMobileFlow: true }
      );
    });

    it('records the failure anonymously once the row has been cleaned up', async () => {
      mockFindOAuthAttemptOwner.mockResolvedValue(undefined);

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/strava/mobile/complete?status=error&reason=invalid_state'
      );
      expect(mockCaptureProviderConnectFailed).toHaveBeenCalledWith(
        undefined,
        'strava',
        'invalid_state',
        { isMobileFlow: true }
      );
    });
  });

  describe('web flow', () => {
    it('still sends a bad cookie state to the web error page', async () => {
      const req = {
        query: { code: 'auth-code', state: 'web-state' },
        cookies: { ll_strava_state: 'a-different-state' },
        user: { id: 'web-user' },
        sessionUser: undefined,
      } as unknown as Request;

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/auth/error?message=Strava%20connection%20failed.%20Please%20try%20again.'
      );
      expect(mockFindOAuthAttemptOwner).not.toHaveBeenCalled();
      expect(mockCaptureProviderConnectFailed).toHaveBeenCalledWith(
        undefined,
        'strava',
        'invalid_state',
        { isMobileFlow: false }
      );
    });

    it('still sends a missing cookie to the web error page, never the trampoline', async () => {
      const req = {
        query: { code: 'auth-code', state: 'web-state' },
        cookies: {},
        user: undefined,
        sessionUser: undefined,
      } as unknown as Request;

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/auth/error?message='));
      expect(res.redirect).not.toHaveBeenCalledWith(expect.stringContaining('/mobile/complete'));
    });

    describe('after a successful connect', () => {
      const req = {
        query: { code: 'auth-code', state: 'web-state' },
        cookies: { ll_strava_state: 'web-state' },
        user: { id: 'web-user' },
        sessionUser: undefined,
      } as unknown as Request;

      it('asks the shared helper whether to prompt for a data source', async () => {
        await handler(req, res, jest.fn() as NextFunction);

        expect(mockShouldPromptForDataSource).toHaveBeenCalledWith('web-user');
        expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173/settings?strava=connected');
      });

      it('prompts when the helper says more than one provider is connected', async () => {
        mockShouldPromptForDataSource.mockResolvedValue(true);

        await handler(req, res, jest.fn() as NextFunction);

        expect(res.redirect).toHaveBeenCalledWith(
          'http://localhost:5173/settings?strava=connected&prompt=choose-source'
        );
      });

      it('sends an onboarding rider to the onboarding step instead', async () => {
        mockShouldPromptForDataSource.mockResolvedValue(true);
        mockUserFindUnique.mockResolvedValue({ onboardingCompleted: false });

        await handler(req, res, jest.fn() as NextFunction);

        expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173/onboarding?step=6');
      });
    });
  });

  describe('mobile flow', () => {
    const req = {
      query: { code: 'auth-code', state: 'm.live' },
      cookies: {},
      user: undefined,
      sessionUser: undefined,
    } as unknown as Request;

    beforeEach(() => {
      mockConsumeOAuthAttempt.mockResolvedValue({
        attempt: { id: 'attempt-1', userId: 'mobile-user-1' },
        verifier: '',
      });
    });

    it('keeps the trampoline prompt param, now driven by the shared helper', async () => {
      mockShouldPromptForDataSource.mockResolvedValue(true);

      await handler(req, res, jest.fn() as NextFunction);

      expect(mockShouldPromptForDataSource).toHaveBeenCalledWith('mobile-user-1');
      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/strava/mobile/complete?status=success&prompt=choose-source'
      );
    });

    it('omits the prompt param with a single provider', async () => {
      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith('/auth/strava/mobile/complete?status=success');
    });

    it('never consults the attempt owner lookup on a live attempt', async () => {
      await handler(req, res, jest.fn() as NextFunction);

      expect(mockFindOAuthAttemptOwner).not.toHaveBeenCalled();
    });
  });
});
