import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Covers the Garmin callback's flow detection and its post-connect redirect.
// Garmin shares consumeOAuthAttempt with the three DB-state providers, so the
// expired-attempt gap in loam-logger#267 applied to it as well.

jest.mock('../lib/garmin-token', () => ({
  revokeGarminTokenForUser: jest.fn(),
}));

jest.mock('../lib/ride-stream-store', () => ({
  deleteRideStreamsForProvider: jest.fn(),
}));

jest.mock('../lib/integration-tokens', () => ({
  revokeIntegration: jest.fn(),
}));

jest.mock('../lib/pcke', () => ({
  randomString: jest.fn(() => 'web-state'),
  sha256: jest.fn(async (input: string) => `hashed_${input}`),
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
  oauthToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  userAccount: { upsert: jest.fn().mockResolvedValue({}) },
  userIntegration: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
  },
  user: { findUnique: mockUserFindUnique },
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(mockPrisma)),
};
jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../lib/logger', () => ({ createLogger: jest.fn(() => mockLog) }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import router from './auth.garmin';

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

function happyPathFetch() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ userId: 'garmin-7' }),
    });
}

describe('GET /garmin/callback', () => {
  const handler = getHandler('/garmin/callback', 'get');
  let res: Response;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GARMIN_TOKEN_URL = 'https://garmin.example/token';
    process.env.GARMIN_CLIENT_ID = 'client-id';
    process.env.GARMIN_REDIRECT_URI = 'http://localhost:4000/auth/garmin/callback';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    res = makeRes();
    mockConsumeOAuthAttempt.mockResolvedValue(null);
    mockShouldPromptForDataSource.mockResolvedValue(false);
    mockUserFindUnique.mockResolvedValue({ onboardingCompleted: true });
    happyPathFetch();
  });

  describe('expired or replayed mobile attempt (loam-logger#267)', () => {
    const req = {
      query: { code: 'auth-code', state: 'm.expired' },
      cookies: {},
      user: undefined,
      sessionUser: undefined,
    } as unknown as Request;

    it('deep-links back into the app with invalid_state', async () => {
      mockFindOAuthAttemptOwner.mockResolvedValue('mobile-user-1');

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith(
        '/auth/garmin/mobile/complete?status=error&reason=invalid_state'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('attributes the failure to the attempt owner when the row still exists', async () => {
      mockFindOAuthAttemptOwner.mockResolvedValue('mobile-user-1');

      await handler(req, res, jest.fn() as NextFunction);

      expect(mockFindOAuthAttemptOwner).toHaveBeenCalledWith({ state: 'm.expired', provider: 'GARMIN' });
      expect(mockCaptureProviderConnectFailed).toHaveBeenCalledWith(
        'mobile-user-1',
        'garmin',
        'invalid_state',
        { isMobileFlow: true }
      );
    });

    it('records the failure anonymously once the row has been cleaned up', async () => {
      mockFindOAuthAttemptOwner.mockResolvedValue(undefined);

      await handler(req, res, jest.fn() as NextFunction);

      expect(mockCaptureProviderConnectFailed).toHaveBeenCalledWith(
        undefined,
        'garmin',
        'invalid_state',
        { isMobileFlow: true }
      );
    });
  });

  describe('web flow', () => {
    it('still sends a bad cookie state to the web error page', async () => {
      const req = {
        query: { code: 'auth-code', state: 'web-state' },
        cookies: { ll_oauth_state: 'a-different-state', ll_pkce_verifier: 'verifier' },
        user: { id: 'web-user' },
        sessionUser: undefined,
      } as unknown as Request;

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/auth/error?message=Garmin%20connection%20failed.%20Please%20try%20again.'
      );
      expect(mockFindOAuthAttemptOwner).not.toHaveBeenCalled();
    });

    describe('after a successful connect', () => {
      const req = {
        query: { code: 'auth-code', state: 'web-state' },
        cookies: { ll_oauth_state: 'web-state', ll_pkce_verifier: 'verifier' },
        user: { id: 'web-user' },
        sessionUser: undefined,
      } as unknown as Request;

      it('lands on settings without a prompt for a single provider', async () => {
        await handler(req, res, jest.fn() as NextFunction);

        expect(mockShouldPromptForDataSource).toHaveBeenCalledWith('web-user');
        expect(res.redirect).toHaveBeenCalledWith('http://localhost:5173/settings?garmin=connected');
      });

      it('prompts to choose a data source once a second provider is connected', async () => {
        mockShouldPromptForDataSource.mockResolvedValue(true);

        await handler(req, res, jest.fn() as NextFunction);

        expect(res.redirect).toHaveBeenCalledWith(
          'http://localhost:5173/settings?garmin=connected&prompt=choose-source'
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
    it('returns at the trampoline without a prompt param', async () => {
      mockConsumeOAuthAttempt.mockResolvedValue({
        attempt: { id: 'attempt-1', userId: 'mobile-user-1' },
        verifier: 'stored-verifier',
      });
      mockShouldPromptForDataSource.mockResolvedValue(true);
      const req = {
        query: { code: 'auth-code', state: 'm.live' },
        cookies: {},
        user: undefined,
        sessionUser: undefined,
      } as unknown as Request;

      await handler(req, res, jest.fn() as NextFunction);

      expect(res.redirect).toHaveBeenCalledWith('/auth/garmin/mobile/complete?status=success');
      expect(mockFindOAuthAttemptOwner).not.toHaveBeenCalled();
    });
  });
});
