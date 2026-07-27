jest.mock('./prisma', () => ({
  prisma: {
    userIntegration: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('./logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Real crypto — the point of these tests is that what lands in the database is
// genuinely encrypted, so mocking it out would defeat them.
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

import {
  getIntegrationTokens,
  saveIntegrationTokens,
  revokeIntegration,
} from './integration-tokens';
import { prisma } from './prisma';
import { encrypt } from './crypto';

const mockFindUnique = prisma.userIntegration.findUnique as jest.Mock;
const mockUpdate = prisma.userIntegration.update as jest.Mock;
const mockUpdateMany = prisma.userIntegration.updateMany as jest.Mock;

describe('getIntegrationTokens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decrypts stored tokens', async () => {
    mockFindUnique.mockResolvedValue({
      accessTokenEnc: encrypt('access-abc'),
      refreshTokenEnc: encrypt('refresh-xyz'),
      expiresAt: new Date('2030-01-01'),
      revokedAt: null,
    });

    const tokens = await getIntegrationTokens('user-1', 'GARMIN');

    expect(tokens).toEqual({
      accessToken: 'access-abc',
      refreshToken: 'refresh-xyz',
      expiresAt: new Date('2030-01-01'),
    });
  });

  it('returns null when the user has no integration', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getIntegrationTokens('user-1', 'GARMIN')).toBeNull();
  });

  // This is what makes a Garmin permission revocation actually stop sync
  // rather than merely get logged.
  it('refuses to return tokens for a revoked integration', async () => {
    mockFindUnique.mockResolvedValue({
      accessTokenEnc: encrypt('access-abc'),
      refreshTokenEnc: null,
      expiresAt: new Date('2030-01-01'),
      revokedAt: new Date('2026-07-01'),
    });

    expect(await getIntegrationTokens('user-1', 'GARMIN')).toBeNull();
  });

  // A rotated or misconfigured key must degrade to "reconnect", not throw
  // through a queue worker and retry forever.
  it('treats undecryptable ciphertext as disconnected instead of throwing', async () => {
    mockFindUnique.mockResolvedValue({
      accessTokenEnc: 'not-valid-ciphertext',
      refreshTokenEnc: null,
      expiresAt: new Date('2030-01-01'),
      revokedAt: null,
    });

    await expect(getIntegrationTokens('user-1', 'GARMIN')).resolves.toBeNull();
  });

  it('handles an integration with no refresh token', async () => {
    mockFindUnique.mockResolvedValue({
      accessTokenEnc: encrypt('access-abc'),
      refreshTokenEnc: null,
      expiresAt: new Date('2030-01-01'),
      revokedAt: null,
    });

    const tokens = await getIntegrationTokens('user-1', 'GARMIN');
    expect(tokens?.refreshToken).toBeNull();
  });
});

describe('saveIntegrationTokens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes ciphertext, never the raw token', async () => {
    await saveIntegrationTokens('user-1', 'GARMIN', {
      accessToken: 'access-abc',
      refreshToken: 'refresh-xyz',
      expiresAt: new Date('2030-01-01'),
    });

    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.accessTokenEnc).not.toContain('access-abc');
    expect(data.refreshTokenEnc).not.toContain('refresh-xyz');
    // …and is genuinely recoverable, not just mangled.
    const { decrypt } = await import('./crypto');
    expect(decrypt(data.accessTokenEnc)).toBe('access-abc');
    expect(decrypt(data.refreshTokenEnc)).toBe('refresh-xyz');
  });

  // Providers often omit refresh_token on refresh; blanking a good one would
  // strand the connection at the next expiry.
  it('leaves the stored refresh token alone when none is supplied', async () => {
    await saveIntegrationTokens('user-1', 'GARMIN', {
      accessToken: 'access-abc',
      expiresAt: new Date('2030-01-01'),
    });

    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('refreshTokenEnc');
  });

  it('leaves it alone for an explicit null too', async () => {
    await saveIntegrationTokens('user-1', 'GARMIN', {
      accessToken: 'access-abc',
      refreshToken: null,
      expiresAt: new Date('2030-01-01'),
    });

    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('refreshTokenEnc');
  });
});

describe('revokeIntegration', () => {
  beforeEach(() => jest.clearAllMocks());

  // A revoked credential we could still decrypt is a credential we are still
  // storing, so revocation destroys the ciphertext as well as flagging the row.
  it('flags the row AND destroys the stored credentials', async () => {
    await revokeIntegration('user-1', 'GARMIN');

    const { where, data } = mockUpdateMany.mock.calls[0][0];
    expect(where).toEqual({ userId: 'user-1', provider: 'GARMIN' });
    expect(data.revokedAt).toBeInstanceOf(Date);
    expect(data.accessTokenEnc).toBe('');
    expect(data.refreshTokenEnc).toBeNull();
  });
});
