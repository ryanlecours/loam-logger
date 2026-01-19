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
  revokeGarminToken,
  revokeGarminTokenForUser,
  getValidGarminToken,
} from './garmin-token';

describe('garmin-token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set required env vars
    process.env.GARMIN_TOKEN_URL = 'https://garmin.test/oauth/token';
    process.env.GARMIN_CLIENT_ID = 'test-client-id';
    process.env.GARMIN_API_BASE = 'https://apis.garmin.com/wellness-api';
  });

  describe('revokeGarminToken', () => {
    it('should return true on successful revocation (200)', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await revokeGarminToken('test-access-token');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://apis.garmin.com/wellness-api/rest/user/registration',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer test-access-token' },
        })
      );
    });

    it('should return true on successful revocation (204)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 204 });

      const result = await revokeGarminToken('test-access-token');

      expect(result).toBe(true);
    });

    it('should return true when token is already invalid (401)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await revokeGarminToken('invalid-token');

      expect(result).toBe(true);
    });

    it('should return true when token is already invalid (403)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      const result = await revokeGarminToken('invalid-token');

      expect(result).toBe(true);
    });

    it('should return false on other HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      const result = await revokeGarminToken('test-token');

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await revokeGarminToken('test-token');

      expect(result).toBe(false);
    });
  });

  describe('revokeGarminTokenForUser', () => {
    it('should return true if no token exists for user', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await revokeGarminTokenForUser('user-123');

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should revoke token when found', async () => {
      mockFindUnique.mockResolvedValue({
        accessToken: 'user-access-token',
      });
      mockFetch.mockResolvedValue({ ok: true });

      const result = await revokeGarminTokenForUser('user-123');

      expect(result).toBe(true);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: {
          userId_provider: {
            userId: 'user-123',
            provider: 'garmin',
          },
        },
      });
    });

    it('should return false on database error', async () => {
      mockFindUnique.mockRejectedValue(new Error('Database error'));

      const result = await revokeGarminTokenForUser('user-123');

      expect(result).toBe(false);
    });
  });

  describe('getValidGarminToken', () => {
    it('should return null if no token exists', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getValidGarminToken('user-123');

      expect(result).toBeNull();
    });

    it('should return existing token if not expired', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      mockFindUnique.mockResolvedValue({
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        expiresAt: futureDate,
      });

      const result = await getValidGarminToken('user-123');

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
        }),
      });
      mockUpdate.mockResolvedValue({});

      const result = await getValidGarminToken('user-123');

      expect(result).toBe('new-access-token');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          userId_provider: {
            userId: 'user-123',
            provider: 'garmin',
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
          expires_in: 3600,
        }),
      });
      mockUpdate.mockResolvedValue({});

      const result = await getValidGarminToken('user-123');

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

      const result = await getValidGarminToken('user-123');

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

      const result = await getValidGarminToken('user-123');

      expect(result).toBeNull();
    });

    it('should return null if missing env vars', async () => {
      delete process.env.GARMIN_TOKEN_URL;
      delete process.env.GARMIN_CLIENT_ID;

      const pastDate = new Date(Date.now() - 60 * 1000);
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: pastDate,
      });

      const result = await getValidGarminToken('user-123');

      expect(result).toBeNull();
    });

    it('should not update refresh token if not provided in response', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000);
      mockFindUnique.mockResolvedValue({
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
        expiresAt: pastDate,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          // No refresh_token in response
          expires_in: 3600,
        }),
      });
      mockUpdate.mockResolvedValue({});

      await getValidGarminToken('user-123');

      // Should update accessToken but not refreshToken
      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          userId_provider: {
            userId: 'user-123',
            provider: 'garmin',
          },
        },
        data: expect.objectContaining({
          accessToken: 'new-access-token',
        }),
      });
      // Verify refreshToken is NOT in the update call
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.data.refreshToken).toBeUndefined();
    });

    describe('race condition prevention', () => {
      it('should only make one refresh request for concurrent calls', async () => {
        const pastDate = new Date(Date.now() - 60 * 1000);
        mockFindUnique.mockResolvedValue({
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          expiresAt: pastDate,
        });

        mockFetch.mockImplementation(async () => {
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            ok: true,
            json: async () => ({
              access_token: 'new-access-token',
              refresh_token: 'new-refresh-token',
              expires_in: 3600,
            }),
          };
        });
        mockUpdate.mockResolvedValue({});

        // Make concurrent calls
        const results = await Promise.all([
          getValidGarminToken('user-123'),
          getValidGarminToken('user-123'),
          getValidGarminToken('user-123'),
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
