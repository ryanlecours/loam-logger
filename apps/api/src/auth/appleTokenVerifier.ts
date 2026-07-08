import { createRemoteJWKSet, jwtVerify } from 'jose';

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_ISSUER = 'https://appleid.apple.com';

/**
 * Cached JWKS fetcher — handles key rotation and caching automatically.
 * Apple rotates keys infrequently (weeks/months). cacheMaxAge of 10 minutes
 * balances freshness with avoiding redundant fetches. cooldownDuration of 30s
 * prevents rapid re-fetches when an unknown kid is encountered during rotation.
 */
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
 *
 * Nonce validation is intentionally omitted. The mobile auth flow is stateless
 * (no server-side session exists before login), so there is no pre-stored nonce
 * to compare against. Token replay is mitigated by the short exp window and
 * the audience/issuer checks enforced by jose. This matches our Google handler
 * which also operates without nonces.
 */
/**
 * Discriminator metadata attached to thrown errors so the route handler can
 * log a specific reason (jose error code or class name) and the failing claim
 * (e.g. 'aud') without re-parsing message text.
 */
export type AppleVerifyErrorDetail = { reason: string; claim?: unknown };

function tagAppleError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const reason =
    'code' in err && err.code != null
      ? String((err as { code: unknown }).code)
      : err.name || 'UNKNOWN';
  const claim = 'claim' in err ? (err as { claim: unknown }).claim : undefined;
  (err as Error & { _apple?: AppleVerifyErrorDetail })._apple = { reason, claim };
  return err;
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  bundleId: string,
): Promise<AppleTokenPayload> {
  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, appleJWKS, {
      issuer: APPLE_ISSUER,
      audience: bundleId,
      algorithms: ['RS256'],
    }));
  } catch (err) {
    throw tagAppleError(err);
  }

  const sub = payload.sub;
  if (!sub) {
    const err = new Error('Apple identity token missing sub claim');
    (err as Error & { _apple?: AppleVerifyErrorDetail })._apple = { reason: 'MISSING_SUB' };
    throw err;
  }

  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified: typeof payload.email_verified === 'string' ? payload.email_verified : undefined,
    is_private_email: typeof payload.is_private_email === 'string' ? payload.is_private_email : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
  };
}
