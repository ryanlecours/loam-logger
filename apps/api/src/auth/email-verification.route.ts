import express from 'express';
import { normalizeEmail, getClientIp } from './utils';
import { validateEmailFormat } from './email.utils';
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendError, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { logger, createLogger } from '../lib/logger';
import {
  consumeEmailVerificationToken,
  isEmailVerificationPending,
  sendVerificationEmailWithinLimit,
} from '../services/email-verification.service';
import {
  EMAIL_VERIFICATION_PENDING_CODE,
  SIGN_IN_GRANT_INVALID_CODE,
  redeemSignInGrant,
} from '../services/email-sign-in-grant.service';
import { clearSignInGrantCookie, readSignInGrantCookie } from './sign-in-grant-cookie';
import { issueMobileTokens, issueWebSession } from './session-issuer';
import { setCsrfCookie } from './csrf';
import { updateLastAuthAt } from './recent-auth';

// Successful sign-ins go to the audit stream, like the other sign-in routes.
const auditLogger = createLogger('auth-audit');

const router = express.Router();

/**
 * POST /auth/verify-email
 * Confirm an address from the link in the verification email. Shared by web
 * and mobile signups; the token is the only authorization. Verifying does not
 * start a session: the client that signed up trades its own sign-in grant for
 * one (the /complete routes below) and anyone else signs in with the
 * password, so a leaked link proves the inbox but never hands out the account.
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

    // The address goes back so a client without a sign-in grant can prefill
    // its sign-in form. It is no secret to whoever holds the link: it arrived
    // in that inbox.
    const result = await consumeEmailVerificationToken(token);
    if (result.ok) {
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { email: true },
      });
      return res.json({ ok: true, email: user?.email });
    }

    if (result.reason === 'already_used') {
      // A second tap on the same link (or a mail scanner that opened it
      // first) should not read as a failure when the address is confirmed.
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { email: true, emailVerified: true },
      });
      if (user?.emailVerified) {
        return res.json({ ok: true, alreadyVerified: true, email: user.email });
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

/** 202 while the email is unverified and the grant is still good. */
function sendPending(res: express.Response) {
  return res.status(202).json({ pending: true, code: EMAIL_VERIFICATION_PENDING_CODE });
}

function sendGrantInvalid(res: express.Response) {
  return sendError(res, 401, 'Sign in with your email and password.', SIGN_IN_GRANT_INVALID_CODE);
}

/**
 * POST /auth/verify-email/complete
 * Sign in the browser that signed up (or tried to sign in before verifying),
 * once the email is verified. The grant arrives in an httpOnly cookie set by
 * /auth/signup or /auth/login, so the verify page and a waiting "check your
 * email" tab can both call this. Answers 202 EMAIL_VERIFICATION_PENDING until
 * the link is opened, then sets the session like /auth/login. A grant signs
 * in once.
 */
router.post('/verify-email/complete', async (req, res) => {
  try {
    const rateLimit = await checkAuthRateLimit('verify-email-complete', getClientIp(req));
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const secret = readSignInGrantCookie(req);
    if (!secret) return sendGrantInvalid(res);

    const result = await redeemSignInGrant(secret, 'web');
    if (!result.ok) {
      if (result.reason === 'pending') return sendPending(res);
      clearSignInGrantCookie(res);
      return sendGrantInvalid(res);
    }

    const { user } = result;
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[EmailVerification] Failed to update lastAuthAt')
    );
    await issueWebSession(res, { id: user.id, email: user.email });
    const csrfToken = setCsrfCookie(res);
    clearSignInGrantCookie(res);

    auditLogger.info({ userId: user.id, provider: 'email' }, 'Signed in after email verification');

    return res.json({ ok: true, mustChangePassword: user.mustChangePassword, csrfToken });
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Web sign-in after verification failed');
    return sendInternalError(res, 'Failed to sign in');
  }
});

/**
 * POST /auth/mobile/verify-email/complete
 * The app's version of /auth/verify-email/complete. The grant comes from the
 * `signInSecret` the signup or login 403 handed the app, sent here as
 * `{ secret }`. Answers like /auth/mobile/login once the email is verified.
 */
router.post('/mobile/verify-email/complete', express.json(), async (req, res) => {
  try {
    const rateLimit = await checkAuthRateLimit('verify-email-complete', getClientIp(req));
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { secret } = (req.body ?? {}) as { secret?: unknown };
    const result = await redeemSignInGrant(secret, 'mobile');
    if (!result.ok) {
      return result.reason === 'pending' ? sendPending(res) : sendGrantInvalid(res);
    }

    const { user } = result;
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[EmailVerification] Failed to update lastAuthAt')
    );
    const { accessToken, refreshToken } = await issueMobileTokens({ id: user.id, email: user.email });

    auditLogger.info({ userId: user.id, provider: 'email' }, 'Mobile signed in after email verification');

    return res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    });
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Mobile sign-in after verification failed');
    return sendInternalError(res, 'Failed to sign in');
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

    // Not awaited, like forgot-password: only a pending account gets a send,
    // so waiting on it would make that case measurably slower and the
    // response time would reveal which addresses are awaiting verification.
    // The call never throws (it logs its own failures).
    if (user && isEmailVerificationPending(user)) {
      void sendVerificationEmailWithinLimit(user, 'user_action');
    }

    return res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[EmailVerification] Resend failed');
    // Same answer as success: failure modes should not be distinguishable.
    return res.json({ ok: true });
  }
});

export default router;
