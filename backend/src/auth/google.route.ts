import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { setSessionCookie, clearSessionCookie } from './session';

const router = express.Router();

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} = process.env;

const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, 'postmessage');

router.post('/google/code', express.json(), async (req, res) => {
  try {
    const { code } = req.body as { code: string };
    if (!code) return res.status(400).send('Missing code');

    const { tokens } = await client.getToken({ code, redirect_uri: 'postmessage' });
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: GOOGLE_CLIENT_ID });
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
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Google login failed', e);
    res.status(500).send('Auth failed');
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

export default router;
