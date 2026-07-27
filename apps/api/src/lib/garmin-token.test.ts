// Garmin tokens live encrypted in UserIntegration. These mocks reflect that;
// `oauthToken` is still here only because of the legacy-adoption path that
// migrates pre-encryption connections off the plaintext table.
const mockIntegrationFindUnique = jest.fn();
const mockIntegrationUpdate = jest.fn();
const mockLegacyFindUnique = jest.fn();
const mockLegacyDeleteMany = jest.fn();
const mockIntegrationUpsert = jest.fn();
const mockAccountFindFirst = jest.fn();
const mockTransaction = jest.fn();

jest.mock('./prisma', () => ({
  prisma: {
    userIntegration: {
      findUnique: mockIntegrationFindUnique,
      update: mockIntegrationUpdate,
      upsert: mockIntegrationUpsert,
    },
    oauthToken: {
      findUnique: mockLegacyFindUnique,
      deleteMany: mockLegacyDeleteMany,
    },
    userAccount: {
      findFirst: mockAccountFindFirst,
    },
    $transaction: mockTransaction,
  },
}));

// Mock logger
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('./logger', () => ({
  logError: jest.fn(),
  createLogger: jest.fn(() => mockLog),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Real crypto: these tests assert that what reaches the database is genuinely
// encrypted, so a stubbed cipher would defeat their purpose.
process.env.TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);

// Import after mocks
import {
  revokeGarminToken,
  revokeGarminTokenForUser,
  getValidGarminToken,
} from './garmin-token';
import { encrypt, decrypt } from './crypto';

/** A live (non-revoked) encrypted integration row as Prisma would return it. */
const integrationRow = (opts: {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: Date;
  revokedAt?: Date | null;
}) => ({
  accessTokenEnc: encrypt(opts.accessToken ?? 'user-access-token'),
  refreshTokenEnc:
    opts.refreshToken === null ? null : encrypt(opts.refreshToken ?? 'refresh-token'),
  expiresAt: opts.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: opts.revokedAt ?? null,
});

describe('garmin-token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set required env vars
    process.env.GARMIN_TOKEN_URL = 'https://garmin.test/oauth/token';
    process.env.GARMIN_CLIENT_ID = 'test-client-id';
    process.env.GARMIN_API_BASE = 'https://apis.garmin.com/wellness-api';
    // Default: no legacy plaintext row to adopt.
    mockLegacyFindUnique.mockResolvedValue(null);
    // Run transaction callbacks against the same mocked client.
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      if (typeof fn === 'function') {
        const { prisma } = jest.requireMock('./prisma') as { prisma: unknown };
        return fn(prisma);
      }
      return undefined;
    });
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

      expect(await revokeGarminToken('test-access-token')).toBe(true);
    });

    it('should return true when token is already invalid (401)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      expect(await revokeGarminToken('invalid-token')).toBe(true);
    });

    it('should return true when token is already invalid (403)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      expect(await revokeGarminToken('invalid-token')).toBe(true);
    });

    it('should return false on other HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });

      expect(await revokeGarminToken('test-token')).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      expect(await revokeGarminToken('test-token')).toBe(false);
    });
  });

  describe('revokeGarminTokenForUser', () => {
    it('should return true if no token exists for user', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);

      const result = await revokeGarminTokenForUser('user-123');

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should revoke token when found', async () => {
      mockIntegrationFindUnique.mockResolvedValue(integrationRow({}));
      mockFetch.mockResolvedValue({ ok: true });

      const result = await revokeGarminTokenForUser('user-123');

      expect(result).toBe(true);
      // Decrypted before being sent to Garmin.
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer user-access-token' },
        })
      );
    });

    it('should return false on database error', async () => {
      mockIntegrationFindUnique.mockRejectedValue(new Error('Database error'));

      expect(await revokeGarminTokenForUser('user-123')).toBe(false);
    });
  });

  describe('getValidGarminToken', () => {
    it('should return null if no token exists', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);

      expect(await getValidGarminToken('user-123')).toBeNull();
    });

    it('should return existing token if not expired', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ accessToken: 'valid-access-token' })
      );

      const result = await getValidGarminToken('user-123');

      expect(result).toBe('valid-access-token');
      expect(mockFetch).not.toHaveBeenCalled(); // No refresh needed
    });

    it('should refresh token when expired', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({
          accessToken: 'expired-access-token',
          expiresAt: new Date(Date.now() - 60 * 1000),
        })
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });
      mockIntegrationUpdate.mockResolvedValue({});

      const result = await getValidGarminToken('user-123');

      expect(result).toBe('new-access-token');

      const call = mockIntegrationUpdate.mock.calls[0][0];
      expect(call.where).toEqual({
        userId_provider: { userId: 'user-123', provider: 'GARMIN' },
      });
      // Stored encrypted, and recoverable.
      expect(call.data.accessTokenEnc).not.toContain('new-access-token');
      expect(decrypt(call.data.accessTokenEnc)).toBe('new-access-token');
      expect(decrypt(call.data.refreshTokenEnc)).toBe('new-refresh-token');
    });

    it('should refresh token when about to expire (within 5 minutes)', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({
          accessToken: 'soon-expired-access-token',
          expiresAt: new Date(Date.now() + 3 * 60 * 1000),
        })
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-access-token', expires_in: 3600 }),
      });
      mockIntegrationUpdate.mockResolvedValue({});

      const result = await getValidGarminToken('user-123');

      expect(result).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalled(); // Refresh was triggered
    });

    it('should return null if no refresh token available', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({
          refreshToken: null,
          expiresAt: new Date(Date.now() - 60 * 1000),
        })
      );

      expect(await getValidGarminToken('user-123')).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null if refresh request fails', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
      );

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      expect(await getValidGarminToken('user-123')).toBeNull();
    });

    it('should return null if missing env vars', async () => {
      delete process.env.GARMIN_TOKEN_URL;
      delete process.env.GARMIN_CLIENT_ID;

      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
      );

      expect(await getValidGarminToken('user-123')).toBeNull();
    });

    it('should not update refresh token if not provided in response', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({
          refreshToken: 'old-refresh-token',
          expiresAt: new Date(Date.now() - 60 * 1000),
        })
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          // No refresh_token in response
          expires_in: 3600,
        }),
      });
      mockIntegrationUpdate.mockResolvedValue({});

      await getValidGarminToken('user-123');

      // Access token rotates; the existing refresh token is left untouched
      // rather than blanked, which would strand the connection at next expiry.
      const updateCall = mockIntegrationUpdate.mock.calls[0][0];
      expect(decrypt(updateCall.data.accessTokenEnc)).toBe('new-access-token');
      expect(updateCall.data.refreshTokenEnc).toBeUndefined();
    });

    // A revoked integration must stay revoked. Garmin tells us about permission
    // withdrawal via webhook; honoring it is a program obligation.
    it('returns null for a revoked integration even before expiry', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ revokedAt: new Date() })
      );

      expect(await getValidGarminToken('user-123')).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    describe('race condition prevention', () => {
      it('should only make one refresh request for concurrent calls', async () => {
        mockIntegrationFindUnique.mockResolvedValue(
          integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
        );

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
        mockIntegrationUpdate.mockResolvedValue({});

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
        expect(mockIntegrationUpdate).toHaveBeenCalledTimes(1);
      });
    });
  });

  // Users who linked Garmin before UserIntegration existed have a plaintext
  // OauthToken row and no encrypted counterpart. Reading only the encrypted
  // store would silently disconnect them.
  describe('legacy plaintext adoption', () => {
    const legacyRow = {
      accessToken: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date('2026-01-01'),
    };

    it('adopts a pre-encryption connection and returns its token', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);
      mockLegacyFindUnique.mockResolvedValue(legacyRow);
      mockAccountFindFirst.mockResolvedValue({ providerUserId: 'garmin-user-1' });

      const result = await getValidGarminToken('user-123');

      expect(result).toBe('legacy-access-token');

      // Encrypted on the way in…
      const upsert = mockIntegrationUpsert.mock.calls[0][0];
      expect(decrypt(upsert.create.accessTokenEnc)).toBe('legacy-access-token');
      expect(decrypt(upsert.create.refreshTokenEnc)).toBe('legacy-refresh-token');
      expect(upsert.create.externalUserId).toBe('garmin-user-1');

      // …and the plaintext row is destroyed in the same transaction.
      expect(mockLegacyDeleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', provider: 'garmin' },
      });
    });

    // The dangerous case. If adoption ran whenever the encrypted read came back
    // empty, a revoked connection would be resurrected from its stale plaintext
    // row — handing out credentials for a user who withdrew consent.
    it('does NOT adopt when the integration exists but is revoked', async () => {
      mockIntegrationFindUnique
        // getIntegrationTokens: revoked → null
        .mockResolvedValueOnce(integrationRow({ revokedAt: new Date() }))
        // existence probe: row is present
        .mockResolvedValueOnce({ id: 'integration-1' });
      mockLegacyFindUnique.mockResolvedValue(legacyRow);

      expect(await getValidGarminToken('user-123')).toBeNull();
      expect(mockIntegrationUpsert).not.toHaveBeenCalled();
      expect(mockLegacyDeleteMany).not.toHaveBeenCalled();
    });

    it('does NOT adopt when the integration exists but failed to decrypt', async () => {
      mockIntegrationFindUnique
        .mockResolvedValueOnce({
          accessTokenEnc: 'corrupt',
          refreshTokenEnc: null,
          expiresAt: new Date(Date.now() + 3600_000),
          revokedAt: null,
        })
        .mockResolvedValueOnce({ id: 'integration-1' });
      mockLegacyFindUnique.mockResolvedValue(legacyRow);

      expect(await getValidGarminToken('user-123')).toBeNull();
      expect(mockIntegrationUpsert).not.toHaveBeenCalled();
    });

    it('returns null when neither store has a connection', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);
      mockLegacyFindUnique.mockResolvedValue(null);

      expect(await getValidGarminToken('user-123')).toBeNull();
      expect(mockIntegrationUpsert).not.toHaveBeenCalled();
    });
  });
});
