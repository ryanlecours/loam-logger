import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { setSessionCookie, clearSessionCookie } from './session';

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
  console.log('[GoogleAuth] Received login code exchange request');

  try {
    const { code } = req.body as { code: string };
    if (!code) {
      console.warn('[GoogleAuth] Missing auth code');
      return res.status(400).send('Missing code');
    }

    const { tokens } = await client.getToken({ code, redirect_uri: 'postmessage' });
    console.log('[GoogleAuth] Tokens received');

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      console.warn('[GoogleAuth] Invalid Google token payload');
      return res.status(401).send('Invalid Google token');
    }

    const user = await ensureUserFromGoogle(
      {
        sub: payload.sub,
        email: payload.email ?? undefined,
        email_verified: payload.email_verified,
        name: payload.name,
        picture: payload.picture,
      },
      {
        id_token: tokens.id_token!,
        access_token: tokens.access_token ?? undefined,
        refresh_token: tokens.refresh_token ?? undefined,
        expires_in: tokens.expiry_date
          ? Math.max(1, Math.floor((tokens.expiry_date - Date.now()) / 1000))
          : undefined,
      }
    );

    setSessionCookie(res, { uid: user.id, email: user.email });
    console.log('[GoogleAuth] Login successful for', user.email);

    res.status(200).json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error) {
        console.error('[GoogleAuth] Login failed:', err.message);
      } else {
        console.error('[GoogleAuth] Unknown login error:', err);
      }
      res.status(500).send('Auth failed');
  }
});

router.post('/logout', (_req, res) => {
  console.log('[GoogleAuth] Logout request');
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

export default router;
