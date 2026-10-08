import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { UnverifiedProviderEmailError, UNVERIFIED_PROVIDER_EMAIL_MESSAGE } from './account-linking';
import { clearSessionCookie } from './session';
import { issueWebSession } from './session-issuer';
import { setCsrfCookie, clearCsrfCookie } from './csrf';
import { updateLastAuthAt } from './recent-auth';
import { getClientIp } from './utils';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { sendTooManyRequests } from '../lib/api-response';
import { startEmailVerification } from '../services/email-verification.service';
import { logger } from '../lib/logger';

const router = express.Router();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  logger.error('[GoogleAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
}

const client = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri: 'postmessage',
});

router.post('/google/code', express.json(), async (req, res) => {
  try {
    // Same per-IP budget as the mobile Google and Apple routes. This route
    // creates accounts too, so it needs the limit as much as signup does.
    const rateLimit = await checkAuthRateLimit('oauth-login', getClientIp(req));
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many login attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { credential } = req.body as { credential?: string };
    if (!credential) return res.status(400).send('Missing credential');

    // Verify the ID token directly
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    if (!p?.sub) return res.status(401).send('Invalid Google token');

    const { user, wasCreated } = await ensureUserFromGoogle({
      sub: p.sub,
      email: p.email ?? undefined,
      email_verified: p.email_verified,
      name: p.name,
      picture: p.picture,
    });
    if (wasCreated && !user.emailVerified) void startEmailVerification(user);

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[GoogleAuth] Failed to update lastAuthAt')
    );

    // Set session and CSRF cookies, return CSRF token for immediate use
    // Include authAt as fallback in case DB lastAuthAt write failed
    await issueWebSession(res, { id: user.id, email: user.email });
    const csrfToken = setCsrfCookie(res);
    res.status(200).json({ ok: true, csrfToken });
  } catch (e) {
    if (e instanceof UnverifiedProviderEmailError) {
      return res.status(401).send(UNVERIFIED_PROVIDER_EMAIL_MESSAGE);
    }
    logger.error({ err: e }, '[GoogleAuth] ID-token login failed');
    res.status(500).send('Auth failed');
  }
});

router.post('/logout', (_req, res) => {
  logger.debug('[GoogleAuth] Logout request');
  clearSessionCookie(res);
  clearCsrfCookie(res);
  res.status(200).json({ ok: true });
});

export default router;
