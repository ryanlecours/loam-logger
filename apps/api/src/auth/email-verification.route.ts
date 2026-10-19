import express from 'express';
import { normalizeEmail, getClientIp } from './utils';
import { validateEmailFormat } from './email.utils';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import {
  consumeEmailVerificationToken,
  isEmailVerificationPending,
  sendVerificationEmailWithinLimit,
} from '../services/email-verification.service';

const router = express.Router();

/**
 * POST /auth/verify-email
 * Confirm an address from the link in the verification email. Shared by web
 * and mobile signups; the token is the only authorization. Verifying does not
 * start a session: the rider signs in afterwards, so a leaked link proves the
 * inbox but never hands out the account.
 */
router.post('/verify-email', express.json(), async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('verify-email', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { token } = req.body as { token?: unknown };
    if (typeof token !== 'string' || !token) {
      return sendBadRequest(res, 'Verification token is required', 'TOKEN_INVALID');
    }

    const result = await consumeEmailVerificationToken(token);
    if (result.ok) {
      return res.json({ ok: true });
    }

    if (result.reason === 'already_used') {
      // A second tap on the same link (or a mail scanner that opened it
      // first) should not read as a failure when the address is confirmed.
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { emailVerified: true },
      });
      if (user?.emailVerified) {
        return res.json({ ok: true, alreadyVerified: true });
      }
      return sendBadRequest(res, 'Verification link is invalid or has expired', 'TOKEN_INVALID');
    }

    if (result.reason === 'expired') {
      return sendBadRequest(res, 'Verification link has expired', 'TOKEN_EXPIRED');
    }
    return sendBadRequest(res, 'Verification link is invalid or has expired', 'TOKEN_INVALID');
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Verify failed');
    return sendInternalError(res, 'Failed to verify email');
  }
});

/**
 * POST /auth/resend-verification
 * Send a fresh verification link. Public, since an unverified account has no
 * session. Always answers 200 so the response does not reveal whether an
 * address is registered or already verified.
 */
router.post('/resend-verification', express.json(), async (req, res) => {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkAuthRateLimit('resend-verification', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail } = req.body as { email?: unknown };
    const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : null;
    if (!email || !validateEmailFormat(email)) {
      return sendBadRequest(res, 'A valid email is required');
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, emailVerificationRequired: true, emailVerified: true },
    });

    if (user && isEmailVerificationPending(user)) {
      await sendVerificationEmailWithinLimit(user, 'user_action');
    }

    return res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Resend failed');
    // Same answer as success: failure modes should not be distinguishable.
    return res.json({ ok: true });
  }
});

export default router;
