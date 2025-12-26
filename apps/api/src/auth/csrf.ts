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
  });
}

// Paths that should skip CSRF validation (login/signup establish sessions)
const CSRF_EXEMPT_PATHS = [
  '/auth/google/code',
  '/auth/signup',
  '/auth/login',
  '/auth/garmin/callback',
  '/auth/strava/callback',
  '/webhooks/garmin',
  '/webhooks/strava',
  '/api/waitlist',
];

/**
 * Middleware to verify CSRF token on state-changing requests.
 * Uses double-submit cookie pattern: cookie value must match header value.
 *
 * Skips verification for:
 * - Non-state-changing methods (GET, HEAD, OPTIONS)
 * - Requests with Bearer token (mobile apps don't use cookies)
 * - Auth endpoints (login/signup establish sessions, no CSRF yet)
 * - Webhook endpoints (authenticated via signatures)
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

  // Skip for exempt paths (login, signup, webhooks)
  if (CSRF_EXEMPT_PATHS.some(path => req.path === path || req.path.startsWith(path + '/'))) {
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
