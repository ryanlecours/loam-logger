import express from 'express';
import { validatePassword, hashPassword } from './password.utils';
import { requireRecentAuth } from './requireRecentAuth';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { sendPasswordAddedNotification } from '../services/password-notification.service';

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
router.post('/password/add', express.json(), requireRecentAuth(), async (req, res) => {
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

    // Get user with current state
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        accounts: {
          select: { provider: true },
        },
      },
    });

    if (!user) {
      return sendUnauthorized(res);
    }

    // Block if user already has a password
    if (user.passwordHash) {
      return sendForbidden(
        res,
        'Account already has a password. Use change-password instead.',
        'ALREADY_HAS_PASSWORD'
      );
    }

    // Verify at least one OAuth provider is linked (safety check)
    // This prevents creating password-only accounts through this endpoint
    if (user.accounts.length === 0) {
      return sendBadRequest(res, 'Cannot add password to this account type');
    }

    // Hash and save password
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Send notification email (non-blocking)
    sendPasswordAddedNotification(user.id).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[PasswordAuth] Add password failed', e);
    return sendInternalError(res, 'Failed to add password');
  }
});

export default router;
