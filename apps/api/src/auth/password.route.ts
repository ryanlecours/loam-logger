import express from 'express';
import { validatePassword, hashPassword } from './password.utils';
import { requireRecentAuth } from './requireRecentAuth';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { sendPasswordAddedNotification } from '../services/password-notification.service';
import { logger } from '../lib/logger';

const router = express.Router();

/**
 * POST /auth/password/add
 * Add password to OAuth-only account (Google users can add a password)
 *
 * Requirements:
 * - User must be authenticated (session cookie)
 * - User must have authenticated recently (within 10 minutes)
 * - User must NOT already have a password
 * - User must have at least one OAuth provider linked (e.g., Google)
 */
router.post('/password/add', express.json(), requireRecentAuth, async (req, res) => {
  try {
    // sessionUser.uid is guaranteed by requireRecentAuth middleware
    const userId = req.sessionUser!.uid;

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('addPassword', userId);
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
      where: { id: userId },
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
      // User ID from valid session doesn't exist in DB - data integrity issue
      return sendInternalError(res, 'Failed to add password');
    }

    // Verify at least one OAuth provider is linked (safety check)
    // This prevents creating password-only accounts through this endpoint
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
    logger.error({ err: e }, '[PasswordAuth] Add password failed');
    return sendInternalError(res, 'Failed to add password');
  }
});

export default router;
