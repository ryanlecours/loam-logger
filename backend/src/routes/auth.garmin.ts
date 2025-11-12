import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { sha256, randomString } from '../lib/pcke.ts'; 
import { addSeconds } from 'date-fns';

type Empty = Record<string, never>
const r: Router = createRouter();

/**
 * 1) Start OAuth — redirect user to Garmin’s consent page with PKCE + state
 */
r.get<Empty, void, Empty>('/auth/garmin/start', async (_req: Request, res: Response) => {
  const AUTH_URL = process.env.GARMIN_AUTH_URL;
  const CLIENT_ID = process.env.GARMIN_CLIENT_ID;
  const REDIRECT_URI = process.env.GARMIN_REDIRECT_URI;
  const SCOPES = process.env.GARMIN_SCOPES ?? '';

  if (!AUTH_URL || !CLIENT_ID || !REDIRECT_URI) {
    const missing = [
      !AUTH_URL && 'GARMIN_AUTH_URL',
      !CLIENT_ID && 'GARMIN_CLIENT_ID',
      !REDIRECT_URI && 'GARMIN_REDIRECT_URI',
    ].filter(Boolean).join(', ');
    return res.status(500).send(`Missing env vars: ${missing}`);
  }

  const state = randomString(24);
  const verifier = randomString(64);
  const challenge = await sha256(verifier);

  // short-lived, httpOnly cookies for PKCE + CSRF state
  res.cookie('ll_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development',
    maxAge: 10 * 60 * 1000, path: '/',
  });
  res.cookie('ll_pkce_verifier', verifier, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development',
    maxAge: 10 * 60 * 1000, path: '/',
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  if (SCOPES) url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return res.redirect(url.toString());
});

/**
 * 2) Callback — exchange code for tokens, store in DB, done.
 */
r.get<Empty, void, Empty, { code?: string; state?: string }>(
  '/auth/garmin/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string }>, res: Response) => {
    const TOKEN_URL = process.env.GARMIN_TOKEN_URL;
    const REDIRECT_URI = process.env.GARMIN_REDIRECT_URI;
    const CLIENT_ID = process.env.GARMIN_CLIENT_ID;
    if (!TOKEN_URL || !REDIRECT_URI || !CLIENT_ID) {
      const missing = [
        !TOKEN_URL && 'GARMIN_TOKEN_URL',
        !REDIRECT_URI && 'GARMIN_REDIRECT_URI',
        !CLIENT_ID && 'GARMIN_CLIENT_ID',
      ].filter(Boolean).join(', ');
      return res.status(500).send(`Missing env vars: ${missing}`);
    }

    const { code, state } = req.query;
    const cookieState = req.cookies['ll_oauth_state'];
    const verifier = req.cookies['ll_pkce_verifier'];

    if (!code || !state || !cookieState || state !== cookieState || !verifier) {
      return res.status(400).send('Invalid OAuth state/PKCE');
    }
    if (!req.user?.id) return res.status(401).send('No user');

    // Token exchange (OAuth2 Authorization Code + PKCE)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    if (process.env.GARMIN_CLIENT_SECRET) {
      body.set('client_secret', process.env.GARMIN_CLIENT_SECRET);
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return res.status(502).send(`Token exchange failed: ${text}`);
    }

    type TokenResp = {
      access_token: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
    }
    const t = (await tokenRes.json()) as TokenResp;
    const expiresAt = addSeconds(new Date(), t.expires_in ?? 3600);

    // Normalize refresh_token to string | null (never undefined)
    const refreshTokenNorm: string | null =
      t.refresh_token !== undefined ? (t.refresh_token ?? null) : null;

    await prisma.oauthToken.upsert({
      where: { userId_provider: { userId: req.user.id, provider: 'garmin' } },
      create: {
        userId: req.user.id,
        provider: 'garmin',
        accessToken: t.access_token,
        refreshToken: refreshTokenNorm, // OK with exactOptionalPropertyTypes
        expiresAt,
      },
      update: {
        accessToken: t.access_token,
        expiresAt,
        // Only touch refreshToken if the field was present in the response
        ...(t.refresh_token !== undefined ? { refreshToken: t.refresh_token ?? null } : {}),
      },
    });

    // Clear PKCE cookies and redirect back to app
    res.clearCookie('ll_oauth_state', { path: '/' });
    res.clearCookie('ll_pkce_verifier', { path: '/' });

    const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
    return res.redirect(`${appBase.replace(/\/$/, '')}/auth/complete`);
  }
);

export default r;
