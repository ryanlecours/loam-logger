import express from 'express';
import { normalizeEmail, getClientIp } from './utils';
import { hashPassword, verifyPassword, validatePassword } from './password.utils';
import { validateEmailFormat } from './email.utils';
import { issueWebSession } from './session-issuer';
import { setCsrfCookie } from './csrf'; // Used by /auth/csrf-token endpoint
import { updateLastAuthAt } from './recent-auth';
import { requireRecentAuth } from './requireRecentAuth';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden, sendConflict, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit, checkMutationRateLimit } from '../lib/rate-limit';
import { sendPasswordChangedNotification } from '../services/password-notification.service';
import {
  consumePasswordResetToken,
  createPasswordResetToken,
  sendPasswordResetEmail,
} from '../services/password-reset.service';
import { logger } from '../lib/logger';
import { config } from '../config/env';
import { createNewUser, verifyEmailAvailable } from '../services/signup.service';

const router = express.Router();

/**
 * POST /auth/signup
 * Add user to waitlist (closed beta)
 */
router.post('/signup', express.json(), async (req, res) => {
  try {
    // Rate limit by IP to prevent automated spam signups
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('signup', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many signup attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail, name, ref } = req.body as {
      email?: string;
      name?: string;
      ref?: string;
    };

    // Validate input - password not required during closed beta
    // Users will receive a temporary password via email when activated
    if (!rawEmail) {
      return sendBadRequest(res, 'Email is required');
    }

    if (!name || name.trim().length === 0) {
      return sendBadRequest(res, 'Name is required');
    }

    if (name.trim().length > 255) {
      return sendBadRequest(res, 'Name is too long (max 255 characters)');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return sendBadRequest(res, 'Invalid email');
    }

    if (!validateEmailFormat(email)) {
      return sendBadRequest(res, 'Invalid email format');
    }

    // Check if user already exists
    const check = await verifyEmailAvailable(email);
    if (!check.available) {
      if (check.role === 'WAITLIST') {
        return sendForbidden(res, 'You are already on the waitlist. We will email you when your account is activated.', 'ALREADY_ON_WAITLIST');
      }
      return sendConflict(res, 'An account with this email already exists. Please log in.');
    }
    const verifiedEmail = check.email;

    if (config.bypassWaitlistFlow) {
      const { password } = req.body as { password?: string };
      if (!password) {
        return sendBadRequest(res, 'Password is required');
      }
      const validation = validatePassword(password);
      if (!validation.isValid) {
        return sendBadRequest(res, validation.error || 'Password does not meet requirements');
      }

      const passwordHash = await hashPassword(password);
      const { user } = await createNewUser({ email: verifiedEmail, name: name.trim(), passwordHash, ref });

      await issueWebSession(res, { id: user.id, email: user.email });
      const csrfToken = setCsrfCookie(res);

      return res.status(201).json({ ok: true, waitlist: false, csrfToken });
    }

    // Waitlist flow
    await createNewUser({ email: verifiedEmail, name: name.trim(), passwordHash: null, ref });

    return sendForbidden(res, 'You have been added to the waitlist. We will email you when your account is activated.', 'ALREADY_ON_WAITLIST');
  } catch (e) {
    logger.error({ err: e }, '[EmailAuth] Signup failed');
    return sendInternalError(res, 'Signup failed');
  }
});

/**
 * POST /auth/login
 * Authenticate user with email and password
 */
router.post('/login', express.json(), async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body as {
      email?: string;
      password?: string;
    };

    // Validate input
    if (!rawEmail || !password) {
      return sendBadRequest(res, 'Email and password are required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return sendBadRequest(res, 'Invalid email');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        mustChangePassword: true,
      },
    });

    if (!user) {
      return sendUnauthorized(res, 'Invalid email or password');
    }

    // Block WAITLIST users - they cannot login until activated
    if (user.role === 'WAITLIST') {
      return sendForbidden(res, 'You are already on the waitlist. We will email you when your account is activated.', 'ALREADY_ON_WAITLIST');
    }

    // Check if user has a password (created via email/password signup)
    if (!user.passwordHash) {
      return sendUnauthorized(res, 'This account uses OAuth login only');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return sendUnauthorized(res, 'Invalid email or password');
    }

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[EmailAuth] Failed to update lastAuthAt')
    );

    // Set session and CSRF cookies, return CSRF token for immediate use
    // Include authAt as fallback in case DB lastAuthAt write failed
    await issueWebSession(res, { id: user.id, email: user.email });
    const csrfToken = setCsrfCookie(res);

    // Return success with mustChangePassword flag and CSRF token
    res.status(200).json({
      ok: true,
      mustChangePassword: user.mustChangePassword,
      csrfToken,
    });
  } catch (e) {
    logger.error({ err: e }, '[EmailAuth] Login failed');
    return sendInternalError(res, 'Login failed');
  }
});

/**
 * POST /auth/change-password
 * Change password for authenticated user
 * Used after login with temporary password
 *
 * Requirements:
 * - User must be authenticated (session cookie)
 * - User must have authenticated recently (within 10 minutes)
 * - User must provide correct current password
 */
router.post('/change-password', express.json(), requireRecentAuth, async (req, res) => {
  try {
    // sessionUser.uid is guaranteed by requireRecentAuth middleware
    const userId = req.sessionUser!.uid;

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('changePassword', userId);
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
      return sendBadRequest(res, validation.error || 'Invalid password');
    }

    // Get user with current password hash and info for notification
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, passwordHash: true, mustChangePassword: true },
    });

    if (!user) {
      // User ID from valid session doesn't exist in DB - data integrity issue
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

    // Hash and save new password, clear mustChangePassword flag, and bump the
    // session token version to invalidate all other active sessions. We re-issue
    // the current session cookie below so the caller stays logged in on this device.
    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        sessionTokenVersion: { increment: 1 },
      },
    });

    // Re-issue the web session cookie stamped with the new sessionTokenVersion
    await issueWebSession(res, { id: user.id, email: user.email });

    // Send notification email (non-blocking)
    sendPasswordChangedNotification({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[EmailAuth] Change password failed');
    return sendInternalError(res, 'Failed to change password');
  }
});

/**
 * POST /auth/forgot-password
 * Start a self-service password reset. Emails a reset link to the user if the
 * address is on file.
 *
 * Always returns 200 regardless of whether the email matches a user — this
 * prevents email enumeration via the response.
 */
router.post('/forgot-password', express.json(), async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('forgot-password', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail } = req.body as { email?: string };

    if (!rawEmail) {
      return sendBadRequest(res, 'Email is required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email || !validateEmailFormat(email)) {
      // Still return 200 to avoid leaking which strings are valid emails on file.
      return res.json({ ok: true });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      try {
        const rawToken = await createPasswordResetToken(user.id);
        await sendPasswordResetEmail(user, rawToken, 'user_action');
      } catch (err) {
        // Log but still return 200 — we don't want the client to infer anything
        // from timing or error state.
        logger.error({ err, userId: user.id }, '[EmailAuth] Forgot password email send failed');
      }
    }

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[EmailAuth] Forgot password failed');
    // Return 200 anyway — failure modes here shouldn't be distinguishable from success.
    res.json({ ok: true });
  }
});

/**
 * POST /auth/reset-password
 * Complete a password reset using a token emailed to the user.
 * This endpoint is unauthenticated — the reset token is the authorization.
 */
router.post('/reset-password', express.json(), async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('reset-password', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { token, newPassword } = req.body as {
      token?: string;
      newPassword?: string;
    };

    if (!token || !newPassword) {
      return sendBadRequest(res, 'Token and new password are required');
    }

    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return sendBadRequest(res, validation.error || 'Password does not meet requirements');
    }

    const result = await consumePasswordResetToken(token);
    if (!result.ok) {
      // Reuse of an already-consumed token is a signal the reset email may
      // have leaked — warn-level so it surfaces on the security channel.
      // `race_expired` is the benign "expired between read and write" case —
      // info-level so it's visible for debugging concurrent-submission
      // behavior without triggering on-call alerts.
      if (result.reason === 'already_used') {
        logger.warn(
          { userId: result.userId, clientIp },
          '[EmailAuth] Password reset token reuse attempted',
        );
      } else if (result.reason === 'race_expired') {
        logger.info(
          { userId: result.userId, clientIp },
          '[EmailAuth] Password reset token expired during consumption',
        );
      }
      // Distinguish expired vs invalid so the client can show a dedicated
      // "request a new link" screen for expired tokens. not_found and
      // already_used collapse into a single generic code to avoid enumeration.
      if (result.reason === 'expired' || result.reason === 'race_expired') {
        return sendBadRequest(res, 'Reset link has expired', 'TOKEN_EXPIRED');
      }
      return sendBadRequest(res, 'Reset link is invalid or has expired', 'TOKEN_INVALID');
    }

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return sendBadRequest(res, 'Reset link is invalid or has expired');
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        // Invalidate all existing sessions — any active cookie/token issued before
        // this reset will fail the version check in attachUser.
        sessionTokenVersion: { increment: 1 },
      },
    });

    sendPasswordChangedNotification({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[EmailAuth] Reset password failed');
    return sendInternalError(res, 'Failed to reset password');
  }
});

/**
 * GET /auth/csrf-token
 * Get or refresh the CSRF token for authenticated sessions.
 * The token is returned in the response body and also set as a cookie.
 */
router.get('/csrf-token', (req, res) => {
  // Only provide CSRF token if user is authenticated via session cookie
  if (!req.sessionUser?.uid) {
    return sendUnauthorized(res, 'Authentication required');
  }

  // Set a new CSRF cookie and return the token
  const token = setCsrfCookie(res);
  res.json({ csrfToken: token });
});

export default router;
