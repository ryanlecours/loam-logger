import express from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { sendBadRequest, sendTooManyRequests, sendInternalError, sendError } from '../lib/api-response';
import { BillingCancellationError } from '../services/account-deletion.service';
import { normalizeEmail, getClientIp } from './utils';
import { validateEmailFormat } from './email.utils';
import { clearSessionCookie } from './session';
import {
  confirmAccountDeletion,
  sendAccountDeletionEmail,
} from '../services/account-deletion-request.service';

const router = express.Router();

/**
 * POST /auth/delete-account/request
 * Public, for riders who can't sign in: emails a link that confirms deleting
 * the account on file for this address.
 *
 * Always returns 200, whether or not the address matches an account, so the
 * response can't be used to find out who has one. Same contract as
 * /auth/forgot-password.
 */
router.post('/delete-account/request', express.json(), async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('delete-account-request', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail } = req.body as { email?: string };
    if (!rawEmail) {
      return sendBadRequest(res, 'Email is required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email || !validateEmailFormat(email)) {
      return res.json({ ok: true });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      try {
        await sendAccountDeletionEmail(user);
      } catch (err) {
        logger.error({ err, userId: user.id }, '[AccountDeletion] Confirmation email send failed');
      }
    }

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[AccountDeletion] Deletion request failed');
    res.json({ ok: true });
  }
});

/**
 * POST /auth/delete-account/confirm
 * Redeems the emailed token and deletes the account. Unauthenticated: the
 * token is the authorization, and proves the caller can read the account's
 * inbox. A POST from the confirm page's button, never a GET on the link.
 */
router.post('/delete-account/confirm', express.json(), async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('delete-account-confirm', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { token } = req.body as { token?: string };
    if (!token) {
      return sendBadRequest(res, 'Token is required');
    }

    const result = await confirmAccountDeletion(token);
    if (!result.ok) {
      if (result.reason === 'expired') {
        return sendBadRequest(res, 'This deletion link has expired', 'TOKEN_EXPIRED');
      }
      return sendBadRequest(res, 'This deletion link is invalid or has already been used', 'TOKEN_INVALID');
    }

    logger.info({ userId: result.userId }, '[AccountDeletion] Account deleted by emailed confirmation');

    // The browser that confirms may also hold a web session for this account.
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (e) {
    // Same answer as DELETE /auth/delete-account: nothing was deleted, and the
    // token is still good, so the rider can retry from the same page.
    if (e instanceof BillingCancellationError) {
      logger.error({ err: e.cause }, '[AccountDeletion] Stripe cancellation failed; account kept');
      return sendError(
        res,
        503,
        "We couldn't cancel your Loam Logger Pro subscription, so your account has not been deleted. Please try again in a few minutes.",
        'BILLING_CANCELLATION_FAILED'
      );
    }
    logger.error({ err: e }, '[AccountDeletion] Confirmed deletion failed');
    return sendInternalError(res, 'An error occurred while deleting your account. Please try again.');
  }
});

export default router;
