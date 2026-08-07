import type { Request } from 'express';
import jwt from 'jsonwebtoken';

const { SESSION_SECRET } = process.env;

export type TokenType = 'access' | 'refresh';

export type TokenPayload = {
  uid: string;
  email?: string;
  /** User's sessionTokenVersion at token issue time — used to revoke tokens after password reset */
  v?: number;
  /**
   * Which kind of token this is. Both kinds are signed with the same
   * SESSION_SECRET, so without this claim they are interchangeable: an
   * access token POSTed to /mobile/refresh would mint a year-long refresh
   * session, and a refresh token in an Authorization header would act as a
   * year-long access token that never touches rotation or reuse detection.
   * Optional only because tokens issued before the claim existed lack it;
   * those are typed by lifetime instead (see isRefreshTokenPayload).
   */
  typ?: TokenType;
  /** Refresh tokens only: MobileSession row id this token belongs to */
  sid?: string;
  /** Refresh tokens only: one-time rotation id, matched against MobileSession.currentJti */
  jti?: string;
  /** Stamped by jwt.sign; present on any verified payload. */
  iat?: number;
  exp?: number;
};

/**
 * Generate a short-lived access token (15 minutes)
 * Used for authenticating mobile API requests
 */
export function generateAccessToken(payload: TokenPayload): string {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return jwt.sign({ ...payload, typ: 'access' }, SESSION_SECRET, { expiresIn: '15m' });
}

/**
 * Generate a long-lived refresh token (365 days)
 * Used for obtaining new access tokens without re-authenticating
 *
 * The TTL is deliberately long and the mobile refresh route rotates the
 * token on every successful refresh, so the session window slides: a rider
 * who opens the app at least once a year is never logged out. Riding is
 * seasonal (a whole winter off is normal), and a mid-ride logout can cost a
 * recording, so expiry is not a safety net worth that price.
 *
 * The long TTL is safe because these tokens are not pure bearer
 * credentials: each is bound to a MobileSession row (sid + one-time jti,
 * see mobile-session.ts), giving per-device revocation and reuse detection
 * when a spent token is replayed. sessionTokenVersion (bumped on password
 * reset/change) additionally kills all of a user's tokens at once.
 */
export function generateRefreshToken(payload: TokenPayload): string {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return jwt.sign({ ...payload, typ: 'refresh' }, SESSION_SECRET, { expiresIn: '365d' });
}

// Legacy tokens (issued before the typ claim) are typed by their signed
// lifetime: access tokens lived 15 minutes, refresh tokens 7 days. One hour
// splits those cleanly. The legacy fallbacks below can be deleted once every
// pre-typ mobile token has expired (7 days after the typ deploy; legacy
// access tokens die in 15 minutes).
const LEGACY_ACCESS_MAX_LIFETIME_S = 60 * 60;

// The exact claims a legacy mobile token can carry: what
// generateAccessToken/generateRefreshToken signed ({uid, email?, v?}) plus
// jwt.sign's own timestamps. The lifetime heuristic is trusted ONLY for
// payloads with exactly this shape — any other claim means the token is
// some other SESSION_SECRET-signed artifact (a web session cookie's authAt,
// an unsubscribe link's purpose, or whatever gets minted next) and must
// never be typed as a mobile credential. This is an allowlist rather than a
// blocklist of known cousins because the failure mode is severe: the
// unsubscribe token ({uid, purpose}, 90-day expiry, embedded in every
// marketing email) passed a pure lifetime test and could be redeemed at
// /mobile/refresh for a fully-authenticated year-long session.
const LEGACY_MOBILE_TOKEN_CLAIMS = new Set(['uid', 'email', 'v', 'iat', 'exp']);

function signedLifetimeSeconds(payload: TokenPayload): number | null {
  return typeof payload.iat === 'number' && typeof payload.exp === 'number'
    ? payload.exp - payload.iat
    : null;
}

function isLegacyMobileShaped(payload: TokenPayload): boolean {
  return Object.keys(payload).every((key) => LEGACY_MOBILE_TOKEN_CLAIMS.has(key));
}

/** True iff this verified payload was issued as a mobile refresh token. */
export function isRefreshTokenPayload(payload: TokenPayload): boolean {
  if (payload.typ !== undefined) return payload.typ === 'refresh';
  if (!isLegacyMobileShaped(payload)) return false;
  const lifetime = signedLifetimeSeconds(payload);
  return lifetime !== null && lifetime > LEGACY_ACCESS_MAX_LIFETIME_S;
}

/** True iff this verified payload was issued as a mobile access token. */
export function isAccessTokenPayload(payload: TokenPayload): boolean {
  if (payload.typ !== undefined) return payload.typ === 'access';
  if (!isLegacyMobileShaped(payload)) return false;
  const lifetime = signedLifetimeSeconds(payload);
  return lifetime !== null && lifetime <= LEGACY_ACCESS_MAX_LIFETIME_S;
}

/**
 * Verify and decode a JWT token
 * Returns the payload if valid, null if invalid or expired
 */
export function verifyToken(token: string): TokenPayload | null {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  try {
    return jwt.verify(token, SESSION_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Extract bearer token from Authorization header
 * Returns the token string or null if not present or malformed
 *
 * Expected format: "Authorization: Bearer <token>"
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}
