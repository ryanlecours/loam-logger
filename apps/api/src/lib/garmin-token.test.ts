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
  getGarminConnectionState,
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
    it('reports disconnected if no token exists', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'disconnected' });
    });

    it('should return existing token if not expired', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ accessToken: 'valid-access-token' })
      );

      const result = await getValidGarminToken('user-123');

      expect(result).toEqual({ ok: true, accessToken: 'valid-access-token' });
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

      expect(result).toEqual({ ok: true, accessToken: 'new-access-token' });

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

      expect(result).toEqual({ ok: true, accessToken: 'new-access-token' });
      expect(mockFetch).toHaveBeenCalled(); // Refresh was triggered
    });

    it('reports refresh_failed if no refresh token available', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({
          refreshToken: null,
          expiresAt: new Date(Date.now() - 60 * 1000),
        })
      );

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'refresh_failed' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports refresh_failed if refresh request fails', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
      );

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'refresh_failed' });
    });

    it('reports refresh_failed if missing env vars', async () => {
      delete process.env.GARMIN_TOKEN_URL;
      delete process.env.GARMIN_CLIENT_ID;

      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
      );

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'refresh_failed' });
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
    it('reports disconnected for a revoked integration even before expiry', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ revokedAt: new Date() })
      );

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'disconnected' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // The distinction the sync worker branches on. A rider who left is dropped
    // quietly; a refresh we could not complete is retried and alerted. Collapsing
    // both into one falsy value is what put a disconnect into the error budget.
    it('separates a rider who disconnected from a refresh that failed', async () => {
      mockIntegrationFindUnique.mockResolvedValue(integrationRow({ revokedAt: new Date() }));
      const revoked = await getValidGarminToken('user-123');

      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
      );
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
      const broken = await getValidGarminToken('user-123');

      expect(revoked).toEqual({ ok: false, reason: 'disconnected' });
      expect(broken).toEqual({ ok: false, reason: 'refresh_failed' });
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
          { ok: true, accessToken: 'new-access-token' },
          { ok: true, accessToken: 'new-access-token' },
          { ok: true, accessToken: 'new-access-token' },
        ]);

        // Only 1 DB update should have been made
        expect(mockIntegrationUpdate).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('getGarminConnectionState', () => {
    it('reports live for a usable integration', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ accessToken: 'valid-access-token' })
      );

      expect(await getGarminConnectionState('user-123')).toBe('live');
    });

    it('reports disconnected for a revoked integration', async () => {
      mockIntegrationFindUnique.mockResolvedValue(integrationRow({ revokedAt: new Date() }));

      expect(await getGarminConnectionState('user-123')).toBe('disconnected');
    });

    it('reports disconnected when there is no integration at all', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);

      expect(await getGarminConnectionState('user-123')).toBe('disconnected');
    });

    // The property the PUSH path depends on: an expired token still means the
    // rider is connected, so an activity already in hand is ingested rather than
    // discarded over a credential it was never going to use.
    it('reports live for an expired token without attempting a refresh', async () => {
      mockIntegrationFindUnique.mockResolvedValue(
        integrationRow({ expiresAt: new Date(Date.now() - 60 * 1000) })
      );

      expect(await getGarminConnectionState('user-123')).toBe('live');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // Users who linked Garmin before UserIntegration existed have a plaintext
  // OauthToken row and no encrypted counterpart. Reading only the encrypted
  // store would silently disconnect them.
  /**
   * The plaintext OauthToken fallback is gone.
   *
   * Garmin tokens were dual-written to OauthToken (plaintext) and
   * UserIntegration (AES-256-GCM) during the migration. An adopt-on-read path
   * encrypted a straggler the first time it was used; once the migration drained
   * the Garmin rows it was dead code holding open a route to a credential store
   * nothing else reads.
   *
   * These pin the shape it left behind: the encrypted store is the only place
   * looked at, so revoked and undecryptable both resolve to "no connection" with
   * no second opinion available. Re-adding a fallback would have to defeat the
   * last assertion in each of these deliberately.
   */
  describe('encrypted store is authoritative', () => {
    it('never reads the legacy plaintext table', async () => {
      mockIntegrationFindUnique.mockResolvedValue(null);

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'disconnected' });
      expect(mockLegacyFindUnique).not.toHaveBeenCalled();
    });

    // The case the old fallback had to guard explicitly: adopting whenever the
    // encrypted read came back empty would resurrect a revoked connection from
    // its stale plaintext row, handing out credentials for a user who withdrew
    // consent. With no fallback there is nothing to get backwards.
    it('reports no connection when the integration is revoked', async () => {
      mockIntegrationFindUnique.mockResolvedValue(integrationRow({ revokedAt: new Date() }));

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'disconnected' });
      expect(mockIntegrationUpsert).not.toHaveBeenCalled();
      expect(mockLegacyFindUnique).not.toHaveBeenCalled();
    });

    it('reports no connection when the ciphertext will not decrypt', async () => {
      mockIntegrationFindUnique.mockResolvedValue({
        accessTokenEnc: 'corrupt',
        refreshTokenEnc: null,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
      });

      expect(await getValidGarminToken('user-123')).toEqual({ ok: false, reason: 'disconnected' });
      expect(mockIntegrationUpsert).not.toHaveBeenCalled();
      expect(mockLegacyFindUnique).not.toHaveBeenCalled();
    });
  });
});
