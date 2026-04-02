import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { setSessionCookie, clearSessionCookie } from './session';
import { setCsrfCookie, clearCsrfCookie } from './csrf';
import { updateLastAuthAt } from './recent-auth';
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
    const { credential, ref } = req.body as { credential?: string; ref?: string };
    if (!credential) return res.status(400).send('Missing credential');

    // Verify the ID token directly
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    if (!p?.sub) return res.status(401).send('Invalid Google token');

    const user = await ensureUserFromGoogle(
      {
        sub: p.sub,
        email: p.email ?? undefined,
        email_verified: p.email_verified,
        name: p.name,
        picture: p.picture,
      },
      undefined,
      ref,
    );

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[GoogleAuth] Failed to update lastAuthAt')
    );

    // Set session and CSRF cookies, return CSRF token for immediate use
    // Include authAt as fallback in case DB lastAuthAt write failed
    setSessionCookie(res, { uid: user.id, email: user.email, authAt: Date.now() });
    const csrfToken = setCsrfCookie(res);
    res.status(200).json({ ok: true, csrfToken });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error({ err: e }, '[GoogleAuth] ID-token login failed');

    // Handle closed beta - new users
    if (errorMessage === 'CLOSED_BETA') {
      return res.status(403).send('CLOSED_BETA');
    }
    // Handle waitlist users trying to login
    if (errorMessage === 'ALREADY_ON_WAITLIST') {
      return res.status(403).send('ALREADY_ON_WAITLIST');
    }

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
