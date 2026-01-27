import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies before imports
const mockRevokeWhoopTokenForUser = jest.fn();
jest.mock('../lib/whoop-token', () => ({
  revokeWhoopTokenForUser: mockRevokeWhoopTokenForUser,
}));

const mockRandomString = jest.fn();
jest.mock('../lib/pcke', () => ({
  randomString: mockRandomString,
}));

const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
const mockDeleteMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    oauthToken: {
      upsert: mockUpsert,
      deleteMany: mockDeleteMany,
    },
    userAccount: {
      upsert: mockUpsert,
      findMany: mockFindMany,
      deleteMany: mockDeleteMany,
    },
    user: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    $transaction: mockTransaction,
  },
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import router after mocks
import router from './auth.whoop';

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
          error: expect.stringContaining('Missing env vars'),
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

      mockUpsert.mockResolvedValue({});
      mockUpdate.mockResolvedValue({});
      mockFindMany.mockResolvedValue([{ provider: 'whoop' }]);
      mockFindUnique.mockResolvedValue({ onboardingCompleted: true });
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

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.prod.whoop.com/developer/v1/user/profile/basic',
        expect.objectContaining({
          headers: { Authorization: 'Bearer new-access-token' },
        })
      );
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
      mockFindUnique.mockResolvedValue({ activeDataSource: 'garmin' });
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

    it('should return success response', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should proceed even if token revocation fails', async () => {
      mockRevokeWhoopTokenForUser.mockResolvedValue(false);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should clear activeDataSource if it was whoop', async () => {
      mockFindUnique.mockResolvedValue({ activeDataSource: 'whoop' });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Transaction should include clearing activeDataSource
      expect(mockTransaction).toHaveBeenCalled();
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
});
