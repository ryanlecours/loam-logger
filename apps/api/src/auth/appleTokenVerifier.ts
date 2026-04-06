import { createRemoteJWKSet, jwtVerify } from 'jose';

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_ISSUER = 'https://appleid.apple.com';

/** Cached JWKS fetcher — handles key rotation and caching automatically */
const appleJWKS = createRemoteJWKSet(APPLE_JWKS_URL, {
  cooldownDuration: 30_000,
  cacheMaxAge: 600_000,
});

export type AppleTokenPayload = {
  sub: string;
  email?: string;
  /** Apple sends this as string "true"/"false", not a boolean */
  email_verified?: string;
  is_private_email?: string;
  nonce?: string;
};

/**
 * Verify an Apple identity token's signature and claims.
 *
 * Uses Apple's public JWKS endpoint for RS256 signature verification.
 * Validates issuer, audience, and expiration automatically via jose.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  bundleId: string,
): Promise<AppleTokenPayload> {
  const { payload } = await jwtVerify(identityToken, appleJWKS, {
    issuer: APPLE_ISSUER,
    audience: bundleId,
    algorithms: ['RS256'],
  });

  const sub = payload.sub;
  if (!sub) {
    throw new Error('Apple identity token missing sub claim');
  }

  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified: typeof payload.email_verified === 'string' ? payload.email_verified : undefined,
    is_private_email: typeof payload.is_private_email === 'string' ? payload.is_private_email : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
  };
}
