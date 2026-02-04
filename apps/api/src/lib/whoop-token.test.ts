// Mock Prisma
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('./prisma', () => ({
  prisma: {
    oauthToken: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

// Mock logger
jest.mock('./logger', () => ({
  logError: jest.fn(),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks
import {
  revokeWhoopToken,
  revokeWhoopTokenForUser,
  getValidWhoopToken,
} from './whoop-token';

describe('whoop-token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set required env vars
    process.env.WHOOP_CLIENT_ID = 'test-client-id';
    process.env.WHOOP_CLIENT_SECRET = 'test-client-secret';
  });

  describe('revokeWhoopToken', () => {
    it('should return true on successful revocation', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const result = await revokeWhoopToken('test-access-token');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.prod.whoop.com/oauth/oauth2/token/revoke',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('should include token and credentials in revoke request body', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await revokeWhoopToken('test-access-token');

      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.get('token')).toBe('test-access-token');
      expect(body.get('token_type_hint')).toBe('access_token');
      expect(body.get('client_id')).toBe('test-client-id');
      expect(body.get('client_secret')).toBe('test-client-secret');
    });

    it('should return true when token is already invalid (401)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await revokeWhoopToken('invalid-token');

      expect(result).toBe(true);
    });

    it('should return false on other HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      const result = await revokeWhoopToken('test-token');

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await revokeWhoopToken('test-token');

      expect(result).toBe(false);
    });

    it('should handle response.text() failure gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => { throw new Error('Cannot read body'); },
      });

      const result = await revokeWhoopToken('test-token');

      expect(result).toBe(false);
    });
  });

  describe('revokeWhoopTokenForUser', () => {
    it('should return true if no token exists for user', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await revokeWhoopTokenForUser('user-123');

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should revoke token when found', async () => {
      mockFindUnique.mockResolvedValue({
        accessToken: 'user-access-token',
      });
      mockFetch.mockResolvedValue({ ok: true });

      const result = await revokeWhoopTokenForUser('user-123');

      expect(result).toBe(true);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: {
          userId_provider: {
            userId: 'user-123',
            provider: 'whoop',
          },
        },
      });
    });

    it('should return false on database error', async () => {
      mockFindUnique.mockRejectedValue(new Error('Database error'));

      const result = await revokeWhoopTokenForUser('user-123');

      expect(result).toBe(false);
    });
  });

  describe('getValidWhoopToken', () => {
    it('should return null if no token exists', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getValidWhoopToken('user-123');

      expect(result).toBeNull();
    });

    it('should return existing token if not expired', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      mockFindUnique.mockResolvedValue({
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        expiresAt: futureDate,
      });

      const result = await getValidWhoopToken('user-123');

      expect(result).toBe('valid-access-token');
      expect(mockFetch).not.toHaveBeenCalled(); // No refresh needed
    });

    it('should refresh token when expired', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000); // 1 minute ago
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: pastDate,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'read:workout read:profile offline',
        }),
      });
      mockUpdate.mockResolvedValue({});

      const result = await getValidWhoopToken('user-123');

      expect(result).toBe('new-access-token');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          userId_provider: {
            userId: 'user-123',
            provider: 'whoop',
          },
        },
        data: expect.objectContaining({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        }),
      });
    });

    it('should refresh token when about to expire (within 5 minutes)', async () => {
      const almostExpired = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes from now
      mockFindUnique.mockResolvedValue({
        accessToken: 'soon-expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: almostExpired,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'read:workout read:profile offline',
        }),
      });
      mockUpdate.mockResolvedValue({});

      const result = await getValidWhoopToken('user-123');

      expect(result).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalled(); // Refresh was triggered
    });

    it('should return null if no refresh token available', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000);
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: null,
        expiresAt: pastDate,
      });

      const result = await getValidWhoopToken('user-123');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null if refresh request fails', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000);
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: pastDate,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      const result = await getValidWhoopToken('user-123');

      expect(result).toBeNull();
    });

    it('should return null if missing env vars', async () => {
      delete process.env.WHOOP_CLIENT_ID;
      delete process.env.WHOOP_CLIENT_SECRET;

      const pastDate = new Date(Date.now() - 60 * 1000);
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: pastDate,
      });

      const result = await getValidWhoopToken('user-123');

      expect(result).toBeNull();
    });

    it('should include correct parameters in refresh request', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000);
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: 'my-refresh-token',
        expiresAt: pastDate,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'offline',
        }),
      });
      mockUpdate.mockResolvedValue({});

      await getValidWhoopToken('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.prod.whoop.com/oauth/oauth2/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('my-refresh-token');
      expect(body.get('client_id')).toBe('test-client-id');
      expect(body.get('client_secret')).toBe('test-client-secret');
      expect(body.get('scope')).toBe('offline');
    });

    describe('race condition prevention', () => {
      it('should only make one refresh request for concurrent calls', async () => {
        const pastDate = new Date(Date.now() - 60 * 1000);
        mockFindUnique.mockResolvedValue({
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          expiresAt: pastDate,
        });

        let _fetchCallCount = 0;
        mockFetch.mockImplementation(async () => {
          _fetchCallCount++;
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            ok: true,
            json: async () => ({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
              expires_in: 3600,
              token_type: 'bearer',
              scope: 'offline',
            }),
          };
        });
        mockUpdate.mockResolvedValue({});

        // Make concurrent calls
        const results = await Promise.all([
          getValidWhoopToken('user-123'),
          getValidWhoopToken('user-123'),
          getValidWhoopToken('user-123'),
        ]);

        // All should get the same result
        expect(results).toEqual([
          'new-access-token',
          'new-access-token',
          'new-access-token',
        ]);

        // Only 1 DB update should have been made
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
