import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { setSessionCookie, clearSessionCookie } from './session';
import { setCsrfCookie, clearCsrfCookie } from './csrf';

const router = express.Router();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('[GoogleAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
}

const client = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri: 'postmessage',
});

router.post('/google/code', express.json(), async (req, res) => {
  try {
    const { credential } = req.body as { credential?: string };
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
    );

    setSessionCookie(res, { uid: user.id, email: user.email });
    setCsrfCookie(res);
    res.status(200).json({ ok: true });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('[GoogleAuth] ID-token login failed', e);

    // Handle beta tester access denial
    if (errorMessage === 'NOT_BETA_TESTER') {
      return res.status(403).send('NOT_BETA_TESTER');
    }

    res.status(500).send('Auth failed');
  }
});

router.post('/logout', (_req, res) => {
  console.log('[GoogleAuth] Logout request');
  clearSessionCookie(res);
  clearCsrfCookie(res);
  res.status(200).json({ ok: true });
});

export default router;
