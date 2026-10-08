import express from 'express';
import { getClientIp } from './utils';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { sendBadRequest, sendInternalError, sendTooManyRequests, sendUnauthorized } from '../lib/api-response';
import { logger } from '../lib/logger';
import {
  consumeEmailVerificationToken,
  createEmailVerificationToken,
  needsEmailVerification,
  sendEmailVerificationEmail,
} from '../services/email-verification.service';

const router = express.Router();

/**
 * POST /auth/verify-email
 * Confirm an email address with the token from the verification email.
 * Unauthenticated: the token is the authorization, so the link works in any
 * browser, signed in or not.
 */
router.post('/verify-email', express.json(), async (req, res) => {
  try {
    const rateLimit = await checkAuthRateLimit('verify-email', getClientIp(req));
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { token } = req.body as { token?: string };
    if (!token) {
      return sendBadRequest(res, 'Token is required', 'TOKEN_INVALID');
    }

    const result = await consumeEmailVerificationToken(token);
    if (!result.ok) {
      // Expired and superseded links get the same "send a new one" answer;
      // an unknown token gets the generic one.
      if (result.reason === 'not_found') {
        return sendBadRequest(res, 'This link is invalid.', 'TOKEN_INVALID');
      }
      return sendBadRequest(res, 'This link has expired or was replaced by a newer one.', 'TOKEN_EXPIRED');
    }

    logger.info({ userId: result.userId }, '[EmailVerification] Email verified');
    return res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Verify failed');
    return sendInternalError(res, 'Could not verify email');
  }
});

/**
 * POST /auth/resend-verification
 * Send a fresh verification link to the signed-in rider. Works with the web
 * session cookie or a mobile bearer token.
 */
router.post('/resend-verification', async (req, res) => {
  try {
    const userId = req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    const rateLimit = await checkAuthRateLimit('resend-verification', userId);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(
        res,
        'Too many verification emails. Check your inbox and spam folder, or try again later.',
        rateLimit.retryAfter
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true, emailVerificationRequired: true },
    });
    if (!user) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    if (!needsEmailVerification(user)) {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const rawToken = await createEmailVerificationToken(user.id);
    await sendEmailVerificationEmail(user, rawToken, 'user_action');
    return res.json({ ok: true, alreadyVerified: false });
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Resend failed');
    return sendInternalError(res, 'Could not send the verification email');
  }
});

export default router;
