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

// Exact paths that skip CSRF validation (login/signup establish sessions)
// These endpoints either create sessions or use alternative authentication (signatures)
const CSRF_EXEMPT_PATHS = new Set([
  '/auth/google/code',     // Google OAuth login - creates session
  '/auth/signup',          // Email signup - creates session
  '/auth/login',           // Email login - creates session
  '/auth/garmin/callback', // Garmin OAuth callback - creates session
  '/auth/strava/callback', // Strava OAuth callback - creates session
  '/webhooks/garmin',      // Garmin webhooks - authenticated via signature
  '/webhooks/strava',      // Strava webhooks - authenticated via signature
]);

/**
 * Middleware to verify CSRF token on state-changing requests.
 * Uses double-submit cookie pattern: cookie value must match header value.
 *
 * Skips verification for:
 * - Non-state-changing methods (GET, HEAD, OPTIONS)
 * - Requests with Bearer token (mobile apps don't use cookies)
 * - Auth endpoints (login/signup establish sessions, no CSRF yet)
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

  // Skip for exempt paths (exact match only for security)
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
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
