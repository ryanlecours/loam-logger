import express from 'express';
import * as Sentry from '@sentry/node';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { ensureUserFromApple } from './ensureUserFromApple';
import { verifyAppleIdentityToken, type AppleVerifyErrorDetail } from './appleTokenVerifier';
import { normalizeEmail, getClientIp } from './utils';
import { validateEmailFormat } from './email.utils';
import { verifyPassword, validatePassword, hashPassword } from './password.utils';
import { generateAccessToken, verifyToken } from './token';
import { issueMobileTokens } from './session-issuer';
import { updateLastAuthAt } from './recent-auth';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit, checkMutationRateLimit } from '../lib/rate-limit';
import { sendPasswordAddedNotification, sendPasswordChangedNotification } from '../services/password-notification.service';
import { logger, createLogger } from '../lib/logger';
import { sendUnauthorized, sendBadRequest, sendForbidden, sendConflict, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { config } from '../config/env';
import { createNewUser, verifyEmailAvailable } from '../services/signup.service';

// Filter Railway logs with `module:"auth-audit"` to see only successful sign-ins and
// account creations — the audit stream. Failure-side logs use the regular `logger`.
const auditLogger = createLogger('auth-audit');

const router = express.Router();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_IOS_CLIENT_ID } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  logger.error('[MobileAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
}
if (!GOOGLE_IOS_CLIENT_ID) {
  logger.warn('[MobileAuth] GOOGLE_IOS_CLIENT_ID not set — iOS token audience not configured');
}

if (!config.appleBundleId) {
  logger.warn('[MobileAuth] APPLE_BUNDLE_ID not set — Apple Sign-In will not work');
}

const googleClient = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
});

/**
 * POST /auth/mobile/signup
 * Register a new active FREE user from the mobile app and return tokens.
 */
router.post('/mobile/signup', express.json(), async (req, res) => {
  try {
    // Rate limit by IP to prevent automated spam signups
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('signup', clientIp);
    if (!rateLimit.allowed) {
      logger.warn({ clientIp, operation: 'signup', retryAfter: rateLimit.retryAfter, route: 'mobile/signup' }, 'Mobile signup rate-limited');
      return sendTooManyRequests(res, 'Too many signup attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail, password, name, ref } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      ref?: string;
    };

    // Validate email
    if (!rawEmail) {
      logger.warn({ field: 'email', route: 'mobile/signup' }, 'Signup 400: email required');
      return sendBadRequest(res, 'Email is required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      logger.warn({ field: 'email', route: 'mobile/signup' }, 'Signup 400: invalid email');
      return sendBadRequest(res, 'Invalid email');
    }

    if (!validateEmailFormat(email)) {
      logger.warn({ field: 'email', route: 'mobile/signup' }, 'Signup 400: invalid email format');
      return sendBadRequest(res, 'Invalid email format');
    }

    // Check if user already exists
    const check = await verifyEmailAvailable(email);
    if (!check.available) {
      logger.info({ code: 'EMAIL_EXISTS', route: 'mobile/signup' }, 'Signup 409: account exists');
      return sendConflict(res, 'An account with this email already exists. Please log in.');
    }
    const verifiedEmail = check.email;

    // Password is required — new users are active immediately and log in with it.
    if (!password) {
      logger.warn({ field: 'password', route: 'mobile/signup' }, 'Signup 400: password required');
      return sendBadRequest(res, 'Password is required');
    }
    const validation = validatePassword(password);
    if (!validation.isValid) {
      logger.warn({ field: 'password', route: 'mobile/signup' }, 'Signup 400: password validation failed');
      return sendBadRequest(res, validation.error || 'Password does not meet requirements');
    }
    const passwordHash = await hashPassword(password);

    const trimmedName = name?.trim() || null;
    if (trimmedName && trimmedName.length > 100) {
      logger.warn({ field: 'name', nameLength: trimmedName.length, route: 'mobile/signup' }, 'Signup 400: name too long');
      return sendBadRequest(res, 'Name must be 100 characters or fewer');
    }

    const { user } = await createNewUser({ email: verifiedEmail, name: trimmedName, passwordHash, ref });

    const { accessToken, refreshToken } = await issueMobileTokens({ id: user.id, email: user.email });

    auditLogger.info({ userId: user.id, provider: 'email', wasCreated: true, hasRef: !!ref }, 'Mobile account created');

    return res.status(201).json({
      ok: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: trimmedName,
        avatarUrl: null,
      },
    });
  } catch (e) {
    logger.error({ err: e, route: 'mobile/signup' }, '[MobileAuth] Signup failed');
    Sentry.captureException(e, { tags: { route: 'mobile/signup' } });
    return sendInternalError(res, 'Signup failed');
  }
});

/**
 * POST /auth/mobile/google
 * Authenticate mobile user with Google ID token
 * Returns access token and refresh token for mobile app
 */
router.post('/mobile/google', express.json(), async (req, res) => {
  let googleSub: string | undefined;
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('oauth-login', clientIp);
    if (!rateLimit.allowed) {
      logger.warn({ clientIp, operation: 'oauth-login', retryAfter: rateLimit.retryAfter, route: 'mobile/google' }, 'Mobile auth rate-limited');
      return sendTooManyRequests(res, 'Too many login attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      logger.warn({ field: 'idToken', route: 'mobile/google' }, 'Google sign-in 400: missing idToken');
      return sendBadRequest(res, 'Missing idToken', 'MISSING_TOKEN');
    }

    // Verify the Google ID token. googleClient.verifyIdToken throws on bad sig / wrong aud / exp.
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: [GOOGLE_CLIENT_ID!, GOOGLE_IOS_CLIENT_ID!].filter(Boolean),
      });
      payload = ticket.getPayload();
    } catch (err) {
      logger.warn({ err, route: 'mobile/google' }, 'Google token verification failed');
      Sentry.captureException(err, { tags: { route: 'mobile/google', stage: 'token-verify' } });
      return sendUnauthorized(res, 'Invalid Google token');
    }
    if (!payload?.sub) {
      logger.warn({ route: 'mobile/google' }, 'Google token missing sub claim');
      return sendUnauthorized(res, 'Invalid Google token');
    }
    googleSub = payload.sub;

    // Create or update user
    const { user, wasCreated } = await ensureUserFromGoogle({
      sub: payload.sub,
      email: payload.email ?? undefined,
      email_verified: payload.email_verified,
      name: payload.name,
      picture: payload.picture,
    });

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[MobileAuth] Failed to update lastAuthAt')
    );

    // Generate tokens for mobile
    const { accessToken, refreshToken } = await issueMobileTokens({ id: user.id, email: user.email });

    auditLogger.info(
      { userId: user.id, sub: payload.sub, provider: 'google', wasCreated },
      wasCreated ? 'Mobile account created' : 'Mobile sign-in succeeded'
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (e) {
    logger.error({ err: e, sub: googleSub, route: 'mobile/google' }, '[MobileAuth] Google login failed');
    Sentry.captureException(e, { tags: { route: 'mobile/google', stage: 'ensure-user' }, contexts: { google_signin: { sub: googleSub ?? 'unknown' } } });
    return sendInternalError(res, 'Authentication failed');
  }
});

/**
 * POST /auth/mobile/apple
 * Authenticate mobile user with Apple ID token
 * Returns access token and refresh token for mobile app
 *
 * Apple only sends the user's email and name on the first authorization.
 * The mobile client must capture and forward these alongside the identity token.
 */
router.post('/mobile/apple', express.json(), async (req, res) => {
  // Track the verified Apple sub across the function so catch-block logs can include it.
  let appleSub: string | undefined;
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('oauth-login', clientIp);
    if (!rateLimit.allowed) {
      logger.warn({ clientIp, operation: 'oauth-login', retryAfter: rateLimit.retryAfter, route: 'mobile/apple' }, 'Mobile auth rate-limited');
      return sendTooManyRequests(res, 'Too many login attempts. Please try again later.', rateLimit.retryAfter);
    }

    // Mobile client sends `{ user: { email, name: { firstName, lastName } } }` — Apple only
    // populates these on the FIRST sign-in per Apple ID, so they may be undefined.
    const { identityToken, user: clientUser, ref } = req.body as {
      identityToken?: string;
      user?: {
        email?: string;
        name?: { firstName?: string; lastName?: string } | null;
      } | null;
      ref?: string;
    };
    const clientEmail = clientUser?.email;

    if (!identityToken) {
      logger.warn({ field: 'identityToken', route: 'mobile/apple' }, 'Apple sign-in 400: missing identityToken');
      return sendBadRequest(res, 'Missing identityToken', 'MISSING_TOKEN');
    }
    if (clientEmail && !validateEmailFormat(clientEmail)) {
      logger.warn({ field: 'email', route: 'mobile/apple' }, 'Apple sign-in 400: invalid client email');
      return sendBadRequest(res, 'Invalid email', 'INVALID_EMAIL');
    }
    if (ref && ref.length > 20) {
      logger.warn({ field: 'ref', refLength: ref.length, route: 'mobile/apple' }, 'Apple sign-in 400: invalid ref');
      return sendBadRequest(res, 'Invalid ref', 'INVALID_REF');
    }
    if (!config.appleBundleId) {
      logger.error({ route: 'mobile/apple' }, '[MobileAuth] APPLE_BUNDLE_ID not configured');
      return sendInternalError(res, 'Authentication failed');
    }

    // Verify Apple identity token signature and claims. jose errors are tagged with
    // `_apple = { reason, claim }` by the verifier so we can log a specific reason
    // (e.g. JWTClaimsValidationFailed on 'aud') without re-parsing message text.
    let applePayload;
    try {
      applePayload = await verifyAppleIdentityToken(identityToken, config.appleBundleId);
    } catch (err) {
      const detail = (err as Error & { _apple?: AppleVerifyErrorDetail })._apple;
      logger.warn(
        { err, reason: detail?.reason, claim: detail?.claim, expectedAudience: config.appleBundleId, route: 'mobile/apple' },
        'Apple token verification failed'
      );
      Sentry.captureException(err, {
        tags: { route: 'mobile/apple', stage: 'token-verify' },
        contexts: { apple_signin: { reason: detail?.reason ?? 'UNKNOWN', claim: String(detail?.claim ?? '') } },
      });
      return sendUnauthorized(res, 'Invalid Apple identity token');
    }
    appleSub = applePayload.sub;
    logger.debug({ sub: applePayload.sub, hasEmail: !!applePayload.email, emailVerified: applePayload.email_verified }, 'Apple token verified');

    // Apple sends email_verified as the string "true"/"false", not a boolean
    const emailVerified = applePayload.email_verified === 'true';
    const givenName = clientUser?.name?.firstName?.slice(0, 50) || null;
    const familyName = clientUser?.name?.lastName?.slice(0, 50) || null;
    const name = [givenName, familyName].filter(Boolean).join(' ') || null;

    // Token email is trusted (verified by Apple) — used for account lookup/linking.
    // Client email is untrusted — only used for new user creation as a fallback.
    const { user, wasCreated } = await ensureUserFromApple({
      sub: applePayload.sub,
      email: applePayload.email,
      clientEmail: clientEmail || undefined,
      email_verified: emailVerified,
      name,
    }, ref);

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[MobileAuth] Failed to update lastAuthAt')
    );

    // Generate tokens for mobile
    const { accessToken, refreshToken } = await issueMobileTokens({ id: user.id, email: user.email });

    auditLogger.info(
      { userId: user.id, sub: applePayload.sub, provider: 'apple', wasCreated },
      wasCreated ? 'Mobile account created' : 'Mobile sign-in succeeded'
    );

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (e) {
    logger.error({ err: e, sub: appleSub, route: 'mobile/apple' }, '[MobileAuth] Apple login failed');
    Sentry.captureException(e, {
      tags: { route: 'mobile/apple', stage: 'ensure-user' },
      contexts: { apple_signin: { sub: appleSub ?? 'unknown' } },
    });
    return sendInternalError(res, 'Authentication failed');
  }
});

/**
 * POST /auth/mobile/login
 * Authenticate mobile user with email and password
 * Returns access token and refresh token for mobile app
 */
router.post('/mobile/login', express.json(), async (req, res) => {
  // NOTE: this route currently has no rate-limit check — out of scope for this change,
  // but worth adding to match /mobile/google and /mobile/apple. Tracked separately.
  try {
    const { email: rawEmail, password } = req.body as {
      email?: string;
      password?: string;
    };

    // Validate input
    if (!rawEmail || !password) {
      logger.warn({ field: !rawEmail ? 'email' : 'password', route: 'mobile/login' }, 'Email login 400: missing credentials');
      return sendBadRequest(res, 'Email and password are required', 'MISSING_CREDENTIALS');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      logger.warn({ field: 'email', route: 'mobile/login' }, 'Email login 400: invalid email');
      return sendBadRequest(res, 'Invalid email', 'INVALID_EMAIL');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        name: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      logger.info({ reason: 'no-such-user', route: 'mobile/login' }, 'Email login 401');
      return sendUnauthorized(res, 'Invalid email or password');
    }

    // Check if user has a password (created via email/password signup)
    if (!user.passwordHash) {
      logger.info({ userId: user.id, reason: 'oauth-only', route: 'mobile/login' }, 'Email login 401: account is OAuth-only');
      return sendUnauthorized(res, 'This account uses OAuth login only');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      logger.info({ userId: user.id, reason: 'bad-password', route: 'mobile/login' }, 'Email login 401: bad password');
      return sendUnauthorized(res, 'Invalid email or password');
    }

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[MobileAuth] Failed to update lastAuthAt')
    );

    // Generate tokens for mobile
    const { accessToken, refreshToken } = await issueMobileTokens({ id: user.id, email: user.email });

    auditLogger.info({ userId: user.id, provider: 'email' }, 'Mobile sign-in succeeded');

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (e) {
    logger.error({ err: e, route: 'mobile/login' }, '[MobileAuth] Email login failed');
    Sentry.captureException(e, { tags: { route: 'mobile/login' } });
    return sendInternalError(res, 'Login failed');
  }
});

/**
 * POST /auth/mobile/refresh
 * Refresh access token using refresh token
 * Returns new access token
 *
 * Note: Token refresh does NOT update lastAuthAt - it doesn't prove fresh authentication.
 */
router.post('/mobile/refresh', express.json(), async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      logger.warn({ field: 'refreshToken', route: 'mobile/refresh' }, 'Refresh 400: missing refreshToken');
      return sendBadRequest(res, 'Missing refreshToken', 'MISSING_TOKEN');
    }

    // Verify refresh token
    const payload = verifyToken(refreshToken);
    if (!payload) {
      // Stale / malformed token is the common case here — info, not warn.
      logger.info({ reason: 'invalid-or-expired', route: 'mobile/refresh' }, 'Refresh 401: token invalid or expired');
      return sendUnauthorized(res, 'Invalid or expired refresh token');
    }

    // Verify user still exists
    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, email: true, sessionTokenVersion: true },
    });

    if (!user) {
      // Token signature was valid but the user row is gone — likely deletion or DB drift.
      logger.error({ uid: payload.uid, route: 'mobile/refresh' }, 'Refresh 401: user not found for valid token');
      return sendUnauthorized(res, 'User not found');
    }

    // Reject refresh tokens issued before a session invalidation (e.g. password reset)
    if ((payload.v ?? 0) !== user.sessionTokenVersion) {
      logger.info({ userId: user.id, tokenVersion: payload.v, currentVersion: user.sessionTokenVersion, route: 'mobile/refresh' }, 'Refresh 401: token revoked by version bump');
      return sendUnauthorized(res, 'Refresh token has been revoked');
    }

    // Generate new access token stamped with the current token version
    const accessToken = generateAccessToken({
      uid: user.id,
      email: user.email,
      v: user.sessionTokenVersion,
    });

    res.status(200).json({ accessToken });
  } catch (e) {
    logger.error({ err: e, route: 'mobile/refresh' }, '[MobileAuth] Token refresh failed');
    Sentry.captureException(e, { tags: { route: 'mobile/refresh' } });
    return sendInternalError(res, 'Token refresh failed');
  }
});

/**
 * POST /auth/mobile/password/add
 * Add password to OAuth-only account (mobile)
 *
 * Mobile access tokens are short-lived (15 min), so if the token is valid,
 * the auth is "recent" by definition. No separate recent-auth check needed.
 */
router.post('/mobile/password/add', express.json(), async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return sendUnauthorized(res);
    }

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('addPassword', sessionUser.uid);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(
        res,
        'Too many password attempts. Please try again later.',
        rateLimit.retryAfter
      );
    }

    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword) {
      return sendBadRequest(res, 'Password is required');
    }

    // Validate password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return sendBadRequest(res, validation.error || 'Password does not meet requirements');
    }

    // Get user with current state (for OAuth check and notification)
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: {
        id: true,
        email: true,
        name: true,
        accounts: {
          select: { provider: true },
        },
      },
    });

    if (!user) {
      // User ID from valid token doesn't exist in DB - data integrity issue
      return sendInternalError(res, 'Failed to add password');
    }

    // Verify at least one OAuth provider is linked
    if (user.accounts.length === 0) {
      return sendBadRequest(res, 'Cannot add password to this account type');
    }

    // Hash password before atomic update
    const passwordHash = await hashPassword(newPassword);

    // Atomic conditional update: only set passwordHash if it's currently null
    // This prevents TOCTOU race conditions where concurrent requests could
    // both pass a null-check before either write completes
    const result = await prisma.user.updateMany({
      where: { id: user.id, passwordHash: null },
      data: { passwordHash },
    });

    // If no rows updated, user already has a password
    if (result.count === 0) {
      return sendForbidden(
        res,
        'Account already has a password. Use change-password instead.',
        'ALREADY_HAS_PASSWORD'
      );
    }

    // Send notification email (non-blocking)
    sendPasswordAddedNotification({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Add password failed');
    return sendInternalError(res, 'Failed to add password');
  }
});

/**
 * POST /auth/mobile/password/change
 * Change password for authenticated user (mobile)
 *
 * Mobile access tokens are short-lived (15 min), so if the token is valid,
 * the auth is "recent" by definition. No separate recent-auth check needed.
 */
router.post('/mobile/password/change', express.json(), async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return sendUnauthorized(res);
    }

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('changePassword', sessionUser.uid);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(
        res,
        'Too many password change attempts. Please try again later.',
        rateLimit.retryAfter
      );
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return sendBadRequest(res, 'Current and new password are required');
    }

    // Validate new password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return sendBadRequest(res, validation.error || 'Password does not meet requirements');
    }

    // Get user with current password hash and info for notification
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: { id: true, email: true, name: true, passwordHash: true, mustChangePassword: true },
    });

    if (!user) {
      // User ID from valid token doesn't exist in DB - data integrity issue
      return sendInternalError(res, 'Failed to change password');
    }

    if (!user.passwordHash) {
      return sendBadRequest(res, 'Cannot change password for this account');
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return sendUnauthorized(res, 'Current password is incorrect');
    }

    // Hash and save new password, clear mustChangePassword flag, and bump
    // sessionTokenVersion to invalidate all other active sessions. We issue a
    // fresh token pair below so this device stays logged in.
    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: sessionUser.uid },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        sessionTokenVersion: { increment: 1 },
      },
    });

    // Issue fresh tokens stamped with the new version so the caller stays logged in
    const { accessToken, refreshToken } = await issueMobileTokens({
      id: user.id,
      email: user.email,
    });

    // Send notification email (non-blocking)
    sendPasswordChangedNotification({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true, accessToken, refreshToken });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Change password failed');
    return sendInternalError(res, 'Failed to change password');
  }
});

export default router;
