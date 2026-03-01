import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { sha256, randomString } from '../lib/pcke';
import { addSeconds } from 'date-fns';
import { sendBadRequest, sendUnauthorized, sendInternalError, sendSuccess } from '../lib/api-response';
import { createLogger } from '../lib/logger';
import { revokeGarminTokenForUser } from '../lib/garmin-token';
import { createOAuthAttempt, consumeOAuthAttempt } from '../lib/oauthState';
import { encrypt } from '../lib/crypto';
import { renderOAuthCompletionPage } from '../lib/oauthCompletionPage';

const log = createLogger('garmin-oauth');

type Empty = Record<string, never>
const r: Router = createRouter();

// ---------------------------------------------------------------------------
// 1) Web Start — redirect user to Garmin's consent page (existing web flow)
// ---------------------------------------------------------------------------
r.get<Empty, void, Empty>('/garmin/start', async (_req: Request, res: Response) => {
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
    return sendInternalError(res, `Missing env vars: ${missing}`);
  }

  const state = randomString(24);
  const verifier = randomString(64);
  const challenge = await sha256(verifier);

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

// ---------------------------------------------------------------------------
// 2) Mobile Start — returns authorizeUrl as JSON (DB-based state)
// ---------------------------------------------------------------------------
r.post<Empty, unknown, Empty>('/garmin/start', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

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
    return sendInternalError(res, `Missing env vars: ${missing}`);
  }

  try {
    const { state, verifier, attempt } = await createOAuthAttempt({
      userId,
      provider: 'GARMIN',
      platform: 'MOBILE',
      includeVerifier: true,
    });

    const challenge = await sha256(verifier);

    const url = new URL(AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    if (SCOPES) url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    log.info({ userId, attemptId: attempt.id, provider: 'GARMIN' }, 'Garmin OAuth start (mobile)');
    return sendSuccess(res, { authorizeUrl: url.toString() });
  } catch (err) {
    log.error({ err, userId }, 'Failed to create Garmin OAuth attempt');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 3) Callback — exchange code for tokens (supports both web + mobile flows)
// ---------------------------------------------------------------------------
r.get<Empty, void, Empty, { code?: string; state?: string }>(
  '/garmin/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string }>, res: Response) => {
    // Determine flow type and extract context
    let userId: string | undefined;
    let verifier: string | undefined;
    let isMobileFlow = false;
    let attemptId: string | undefined;

    const { code, state } = req.query;

    // Helper to redirect on error (mobile or web)
    function redirectError(reason: string) {
      if (isMobileFlow) {
        return res.redirect(`/auth/garmin/mobile/complete?status=error&reason=${encodeURIComponent(reason)}`);
      }
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      return res.redirect(`${appBase}/auth/error?message=${encodeURIComponent('Garmin connection failed. Please try again.')}`);
    }

    try {
      const TOKEN_URL = process.env.GARMIN_TOKEN_URL;
      const REDIRECT_URI = process.env.GARMIN_REDIRECT_URI;
      const CLIENT_ID = process.env.GARMIN_CLIENT_ID;

      if (!TOKEN_URL || !REDIRECT_URI || !CLIENT_ID) {
        const missing = [
          !TOKEN_URL && 'GARMIN_TOKEN_URL',
          !REDIRECT_URI && 'GARMIN_REDIRECT_URI',
          !CLIENT_ID && 'GARMIN_CLIENT_ID',
        ].filter(Boolean).join(', ');
        log.error({ missing }, 'Missing env vars for Garmin callback');
        return sendInternalError(res, `Missing env vars: ${missing}`);
      }

      if (!code || !state) {
        return sendBadRequest(res, 'Missing code or state');
      }

      // Try DB-based validation first (mobile flow) — atomic consume prevents replay
      const dbAttempt = await consumeOAuthAttempt({ state, provider: 'GARMIN' });
      if (dbAttempt) {
        isMobileFlow = true;
        userId = dbAttempt.attempt.userId;
        verifier = dbAttempt.verifier;
        attemptId = dbAttempt.attempt.id;
        log.info({ userId, attemptId }, 'Garmin callback: mobile flow (DB state)');
      } else {
        // Fall back to cookie-based validation (web flow)
        const cookieState = req.cookies['ll_oauth_state'];
        const cookieVerifier = req.cookies['ll_pkce_verifier'];

        if (!cookieState || state !== cookieState || !cookieVerifier) {
          log.warn({ hasState: !!cookieState, statesMatch: state === cookieState }, 'Garmin callback: invalid state');
          return redirectError('invalid_state');
        }

        userId = req.user?.id || req.sessionUser?.uid;
        verifier = cookieVerifier;
        log.info({ userId }, 'Garmin callback: web flow (cookie state)');
      }

      if (!userId) {
        log.warn('Garmin callback: no authenticated user');
        return redirectError('invalid_state');
      }

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
        const body = await tokenRes.text();
        log.error({ status: tokenRes.status, userId, attemptId, body }, 'Garmin token exchange failed');
        return redirectError('token_exchange_failed');
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

      const refreshTokenNorm: string | null =
        t.refresh_token !== undefined ? (t.refresh_token ?? null) : null;

      // Fetch Garmin User ID
      const GARMIN_API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api';
      const userIdRes = await fetch(`${GARMIN_API_BASE}/rest/user/id`, {
        headers: {
          'Authorization': `Bearer ${t.access_token}`,
          'Accept': 'application/json'
        },
      });

      if (!userIdRes.ok) {
        log.error({ status: userIdRes.status, userId, attemptId }, 'Failed to fetch Garmin User ID');
        return redirectError('garmin_api_error');
      }

      type GarminUserIdResp = { userId: string };
      const garminUser = (await userIdRes.json()) as GarminUserIdResp;
      const garminUserId = garminUser.userId;

      // TODO: Remove OauthToken dual-write once webhooks/sync workers and token
      // refresh helpers (garmin-token.ts) are migrated to read from UserIntegration.
      // OauthToken stores plaintext tokens; UserIntegration uses AES-256-GCM encryption.
      await prisma.oauthToken.upsert({
        where: { userId_provider: { userId, provider: 'garmin' } },
        create: {
          userId,
          provider: 'garmin',
          accessToken: t.access_token,
          refreshToken: refreshTokenNorm,
          expiresAt,
        },
        update: {
          accessToken: t.access_token,
          expiresAt,
          ...(t.refresh_token !== undefined ? { refreshToken: t.refresh_token ?? null } : {}),
        },
      });

      await prisma.userAccount.upsert({
        where: {
          provider_providerUserId: {
            provider: 'garmin',
            providerUserId: garminUserId
          }
        },
        create: {
          userId,
          provider: 'garmin',
          providerUserId: garminUserId,
        },
        update: {
          userId,
        },
      });

      // UserIntegration upsert (encrypted tokens)
      await prisma.userIntegration.upsert({
        where: { userId_provider: { userId, provider: 'GARMIN' } },
        create: {
          userId,
          provider: 'GARMIN',
          externalUserId: garminUserId,
          accessTokenEnc: encrypt(t.access_token),
          refreshTokenEnc: refreshTokenNorm ? encrypt(refreshTokenNorm) : null,
          expiresAt,
          scopes: t.scope ?? process.env.GARMIN_SCOPES ?? null,
          connectedAt: new Date(),
        },
        update: {
          externalUserId: garminUserId,
          accessTokenEnc: encrypt(t.access_token),
          refreshTokenEnc: refreshTokenNorm ? encrypt(refreshTokenNorm) : null,
          expiresAt,
          scopes: t.scope ?? process.env.GARMIN_SCOPES ?? null,
          connectedAt: new Date(),
          revokedAt: null, // clear any previous revocation
        },
      });

      if (isMobileFlow && attemptId) {
        // Attempt already consumed atomically by consumeOAuthAttempt
        log.info({ userId, attemptId }, 'Garmin OAuth callback success (mobile)');
        return res.redirect('/auth/garmin/mobile/complete?status=success');
      }

      // Web flow: clear cookies and redirect
      res.clearCookie('ll_oauth_state', { path: '/' });
      res.clearCookie('ll_pkce_verifier', { path: '/' });

      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const redirectPath = !user?.onboardingCompleted ? '/onboarding?step=6' : '/settings?garmin=connected';

      log.info({ userId }, 'Garmin OAuth callback success (web)');
      return res.redirect(`${appBase.replace(/\/$/, '')}${redirectPath}`);
    } catch (err) {
      log.error({ err, userId, attemptId }, 'Garmin callback failed');
      return redirectError('internal_error');
    }
  }
);

// ---------------------------------------------------------------------------
// 4) Mobile completion page — deep link trampoline
// ---------------------------------------------------------------------------
r.get('/garmin/mobile/complete', (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'error';
  const reason = req.query.reason as string | undefined;
  const scheme = process.env.MOBILE_DEEP_LINK_SCHEME || 'loamlogger';

  log.debug({ status, reason }, 'Rendering Garmin mobile completion page');

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderOAuthCompletionPage({
    provider: 'Garmin',
    status,
    reason,
    scheme,
    brandColor: '#007dc3',
  }));
});

// ---------------------------------------------------------------------------
// 5) Status — connection status for mobile UI
// ---------------------------------------------------------------------------
r.get('/garmin/status', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // Check UserIntegration first (new model)
    const integration = await prisma.userIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'GARMIN' } },
    });

    if (integration && !integration.revokedAt) {
      return sendSuccess(res, {
        connected: true,
        connectedAt: integration.connectedAt.toISOString(),
        revokedAt: null,
        lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
        scopes: integration.scopes,
      });
    }

    // Fallback: check OauthToken during transition period
    const oauthToken = await prisma.oauthToken.findUnique({
      where: { userId_provider: { userId, provider: 'garmin' } },
    });

    if (oauthToken) {
      return sendSuccess(res, {
        connected: true,
        connectedAt: oauthToken.createdAt.toISOString(),
        revokedAt: null,
        lastSyncAt: null,
        scopes: null,
      });
    }

    return sendSuccess(res, { connected: false });
  } catch (err) {
    log.error({ err, userId }, 'Failed to get Garmin status');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 6) Mobile Disconnect — POST (Bearer token auth)
// ---------------------------------------------------------------------------
r.post('/garmin/disconnect', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await revokeGarminTokenForUser(userId);
    if (!revoked) {
      log.warn({ userId }, 'Garmin token revocation failed, proceeding with local cleanup');
    }

    // Soft-revoke UserIntegration
    await prisma.userIntegration.updateMany({
      where: { userId, provider: 'GARMIN' },
      data: { revokedAt: new Date() },
    });

    // Delete from existing models (backward compat)
    await prisma.$transaction([
      prisma.oauthToken.deleteMany({
        where: { userId, provider: 'garmin' },
      }),
      prisma.userAccount.deleteMany({
        where: { userId, provider: 'garmin' },
      }),
    ]);

    log.info({ userId, revoked }, 'Garmin disconnected (mobile)');
    return sendSuccess(res, { ok: true });
  } catch (err) {
    log.error({ err, userId }, 'Garmin disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

// ---------------------------------------------------------------------------
// 7) Web Disconnect — DELETE (existing, backward compat)
// ---------------------------------------------------------------------------
r.delete<Empty, void, Empty>('/garmin/disconnect', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await revokeGarminTokenForUser(userId);
    if (!revoked) {
      log.warn({ userId }, 'Garmin token revocation failed, proceeding with local cleanup');
    }

    // Soft-revoke UserIntegration
    await prisma.userIntegration.updateMany({
      where: { userId, provider: 'GARMIN' },
      data: { revokedAt: new Date() },
    });

    await prisma.$transaction([
      prisma.oauthToken.deleteMany({
        where: { userId, provider: 'garmin' },
      }),
      prisma.userAccount.deleteMany({
        where: { userId, provider: 'garmin' },
      }),
    ]);

    log.info({ userId, revoked }, 'Garmin disconnected (web)');
    return res.status(200).json({ success: true });
  } catch (err) {
    log.error({ err, userId }, 'Garmin disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

export default r;
