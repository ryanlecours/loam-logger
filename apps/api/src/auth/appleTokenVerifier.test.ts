import { verifyAppleIdentityToken } from './appleTokenVerifier';

const mockJwtVerify = jest.fn();
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

const BUNDLE_ID = 'com.loam.app';

describe('verifyAppleIdentityToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return payload for valid token', async () => {
    const jwtPayload = {
      sub: 'apple-001.abc123',
      email: 'user@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
      iss: 'https://appleid.apple.com',
      aud: BUNDLE_ID,
    };
    mockJwtVerify.mockResolvedValue({ payload: jwtPayload });

    const result = await verifyAppleIdentityToken('valid-token', BUNDLE_ID);

    expect(result).toEqual({
      sub: 'apple-001.abc123',
      email: 'user@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
      nonce: undefined,
    });
    expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', 'mock-jwks', {
      issuer: 'https://appleid.apple.com',
      audience: BUNDLE_ID,
      algorithms: ['RS256'],
    });
  });

  it('should reject token missing sub claim', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { email: 'test@test.com' } });

    await expect(verifyAppleIdentityToken('no-sub-token', BUNDLE_ID))
      .rejects.toThrow('Apple identity token missing sub claim');
  });

  it('should propagate jose verification errors', async () => {
    mockJwtVerify.mockRejectedValue(new Error('JWS signature verification failed'));

    await expect(verifyAppleIdentityToken('bad-token', BUNDLE_ID))
      .rejects.toThrow('JWS signature verification failed');
  });
});
