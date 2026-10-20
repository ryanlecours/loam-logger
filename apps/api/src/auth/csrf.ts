import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const CSRF_COOKIE_NAME = 'll_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32;

/**
 * Generate a cryptographically secure CSRF token.
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/** Whether a value has the shape generateCsrfToken produces. */
export function isWellFormedCsrfToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === CSRF_TOKEN_LENGTH * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

/**
 * Set the CSRF cookie if not already present.
 * Called on session establishment (login, signup).
 */
export function setCsrfCookie(res: Response): string {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.APP_ENV === 'production',
    sameSite: process.env.APP_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // Same as session cookie
    path: '/', // Ensure cookie is sent to all routes, not just /auth/*
  });
  return token;
}

/**
 * Clear the CSRF cookie (on logout).
 */
export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.APP_ENV === 'production',
    sameSite: process.env.APP_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });
}

// Exact paths that skip CSRF validation, in two groups.
//
// Browser-facing routes our web app calls. They create sessions (or act only
// on what the body carries), so they can't require a token the caller doesn't
// have yet. They must send a JSON body instead. An HTML form can only send
// urlencoded, multipart or text/plain, and a cross-site form POST needs no
// CORS preflight, so without this rule a third-party page could POST the
// attacker's credentials to /auth/login and the SameSite=None session cookie
// would sign the visitor's browser into the attacker's account (login CSRF).
// A JSON Content-Type forces a preflight, which CORS refuses for any origin
// we don't list.
const JSON_ONLY_EXEMPT_PATHS = new Set([
  '/auth/google/code',     // Google OAuth login - creates session
  '/auth/signup',          // Email signup - creates session
  '/auth/login',           // Email login - creates session
  '/auth/link-provider',   // Google link after password check - creates session
  // Email verification. Neither reads or changes the session: the token or
  // the address in the body is all they act on, so a signed-in tab that
  // opens a verify link (or asks for another) must not be refused.
  '/auth/verify-email',
  '/auth/resend-verification',
  '/api/waitlist',         // Public waitlist signup - no session required
]);

// Provider callbacks and webhooks. Providers call these, not our web app, so
// they keep whatever body format the provider sends. They carry no session
// cookie to protect. See the per-entry notes: not all of them are
// signature-verified.
const PROVIDER_EXEMPT_PATHS = new Set([
  '/auth/garmin/callback', // Garmin OAuth callback - creates session
  '/auth/strava/callback', // Strava OAuth callback - creates session
  // Garmin webhooks. NOT signature-verified today, despite what this list's
  // header says — Garmin's Activity API does not sign its notifications, so
  // there is nothing to verify. What limits the blast radius instead: every
  // handler resolves the caller's Garmin userId against our UserAccount table
  // and no-ops on an unknown id, the payloads carry no authorization, and the
  // only side effects are enqueuing a sync for an already-linked account or
  // removing that account's own data. A forged deregistration could still
  // disconnect a known rider, so a shared-secret path parameter or an
  // allowlist on Garmin's egress IPs would be a real improvement.
  '/webhooks/garmin',
  '/webhooks/strava',      // Strava webhooks - authenticated via signature
]);

/**
 * Middleware to verify CSRF token on state-changing requests.
 * Uses double-submit cookie pattern: cookie value must match header value.
 *
 * Skips verification for:
 * - Non-state-changing methods (GET, HEAD, OPTIONS)
 * - Requests with Bearer token (mobile apps don't use cookies)
 * - Auth endpoints (login/signup establish sessions, no CSRF yet). These
 *   must send a JSON body instead, or they are refused with 415.
 * - Webhook endpoints (authenticated via signatures)
 * - Unauthenticated requests (no session cookie)
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip for Bearer token auth (mobile apps)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return next();
  }

  // Skip for exempt paths (exact match only for security). The browser-facing
  // ones accept JSON only; see JSON_ONLY_EXEMPT_PATHS for why.
  if (JSON_ONLY_EXEMPT_PATHS.has(req.path)) {
    if (!req.is('application/json')) {
      res.status(415).json({
        success: false,
        error: 'Content-Type must be application/json',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
      return;
    }
    return next();
  }
  if (PROVIDER_EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  // Skip if no session cookie (unauthenticated requests)
  if (!req.cookies?.ll_session) {
    return next();
  }

  // Get CSRF token from cookie and header
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  // Validate tokens exist and match
  if (!cookieToken || !headerToken) {
    res.status(403).json({
      success: false,
      error: 'CSRF token missing',
      code: 'CSRF_MISSING',
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  // timingSafeEqual requires equal length buffers, so check length first
  if (
    cookieToken.length !== headerToken.length ||
    !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    res.status(403).json({
      success: false,
      error: 'CSRF token mismatch',
      code: 'CSRF_INVALID',
    });
    return;
  }

  next();
}
