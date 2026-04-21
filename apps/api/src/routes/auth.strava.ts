import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { randomString } from '../lib/pcke';
import { sendBadRequest, sendUnauthorized, sendInternalError, sendSuccess, sendTooManyRequests } from '../lib/api-response';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { createLogger } from '../lib/logger';
import { revokeStravaTokenForUser } from '../lib/strava-token';
import { createOAuthAttempt, consumeOAuthAttempt } from '../lib/oauthState';
import { encrypt } from '../lib/crypto';
import { renderOAuthCompletionPage } from '../lib/oauthCompletionPage';
import { captureServerEvent } from '../lib/posthog';

const log = createLogger('strava-oauth');

type Empty = Record<string, never>;
const r: Router = createRouter();

// ---------------------------------------------------------------------------
// 1) Web Start — redirect user to Strava's consent page (existing web flow)
// ---------------------------------------------------------------------------
r.get<Empty, void, Empty>('/strava/start', async (_req: Request, res: Response) => {
  const AUTH_URL = 'https://www.strava.com/oauth/authorize';
  const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
  const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
  const SCOPE = 'activity:read_all';

  if (!CLIENT_ID || !REDIRECT_URI) {
    const missing = [
      !CLIENT_ID && 'STRAVA_CLIENT_ID',
      !REDIRECT_URI && 'STRAVA_REDIRECT_URI',
    ].filter(Boolean).join(', ');
    log.error({ missing }, 'Missing env vars for Strava start (web)');
    return sendInternalError(res, 'Strava OAuth is not configured');
  }

  const state = randomString(24);

  res.cookie('ll_strava_state', state, {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);

  return res.redirect(url.toString());
});

// ---------------------------------------------------------------------------
// 2) Mobile Start — returns authorizeUrl as JSON (DB-based state)
// ---------------------------------------------------------------------------
r.post<Empty, unknown, Empty>('/strava/start', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  const rateLimit = await checkMutationRateLimit('oauthStart', userId);
  if (!rateLimit.allowed) {
    return sendTooManyRequests(res, 'Too many OAuth attempts. Please try again later.', rateLimit.retryAfter);
  }

  const AUTH_URL = 'https://www.strava.com/oauth/authorize';
  const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
  const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
  const SCOPE = 'activity:read_all';

  if (!CLIENT_ID || !REDIRECT_URI) {
    const missing = [
      !CLIENT_ID && 'STRAVA_CLIENT_ID',
      !REDIRECT_URI && 'STRAVA_REDIRECT_URI',
    ].filter(Boolean).join(', ');
    log.error({ missing }, 'Missing env vars for Strava start (mobile)');
    return sendInternalError(res, 'Strava OAuth is not configured');
  }

  try {
    const { state, attempt } = await createOAuthAttempt({
      userId,
      provider: 'STRAVA',
      platform: 'MOBILE',
      includeVerifier: false,
    });

    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);

    log.info({ userId, attemptId: attempt.id, provider: 'STRAVA' }, 'Strava OAuth start (mobile)');
    return sendSuccess(res, { authorizeUrl: url.toString() });
  } catch (err) {
    log.error({ err, userId }, 'Failed to create Strava OAuth attempt');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 3) Callback — exchange code for tokens (supports both web + mobile flows)
// ---------------------------------------------------------------------------
r.get<Empty, void, Empty, { code?: string; state?: string; scope?: string }>(
  '/strava/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string; scope?: string }>, res: Response) => {
    let userId: string | undefined;
    let isMobileFlow = false;
    let attemptId: string | undefined;

    const { code, state } = req.query;

    function redirectError(reason: string) {
      if (isMobileFlow) {
        return res.redirect(`/auth/strava/mobile/complete?status=error&reason=${encodeURIComponent(reason)}`);
      }
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      const message = reason === 'account_already_linked'
        ? 'This Strava account is already linked to another user.'
        : 'Strava connection failed. Please try again.';
      return res.redirect(
        `${appBase}/auth/error?message=${encodeURIComponent(message)}`
      );
    }

    try {
      const TOKEN_URL = 'https://www.strava.com/oauth/token';
      const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
      const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
      const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

      if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
        const missing = [
          !CLIENT_ID && 'STRAVA_CLIENT_ID',
          !CLIENT_SECRET && 'STRAVA_CLIENT_SECRET',
          !REDIRECT_URI && 'STRAVA_REDIRECT_URI',
        ].filter(Boolean).join(', ');
        log.error({ missing }, 'Missing env vars for Strava callback');
        return sendInternalError(res, 'Strava OAuth is not configured');
      }

      if (!code || !state) {
        return sendBadRequest(res, 'Missing code or state');
      }

      // Try DB-based validation first (mobile flow) — atomic consume prevents replay
      const dbAttempt = await consumeOAuthAttempt({ state, provider: 'STRAVA' });
      if (dbAttempt) {
        isMobileFlow = true;
        userId = dbAttempt.attempt.userId;
        attemptId = dbAttempt.attempt.id;
        log.info({ userId, attemptId }, 'Strava callback: mobile flow (DB state)');
      } else {
        // Fall back to cookie-based validation (web flow)
        const cookieState = req.cookies['ll_strava_state'];

        if (!cookieState || state !== cookieState) {
          log.warn({ hasState: !!cookieState, statesMatch: state === cookieState }, 'Strava callback: invalid state');
          return redirectError('invalid_state');
        }

        userId = req.user?.id || req.sessionUser?.uid;
        log.info({ userId }, 'Strava callback: web flow (cookie state)');
      }

      if (!userId) {
        log.warn('Strava callback: no authenticated user');
        return redirectError('invalid_state');
      }

      const authenticatedUserId = userId;

      // Token exchange (OAuth2 Authorization Code — no PKCE for Strava)
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      });

      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        log.error({ status: tokenRes.status, userId, attemptId, body: body.slice(0, 200) }, 'Strava token exchange failed');
        return redirectError('token_exchange_failed');
      }

      type StravaTokenResp = {
        access_token: string;
        refresh_token: string;
        expires_at: number;
        expires_in: number;
        token_type: string;
        athlete: {
          id: number;
          username?: string;
          firstname?: string;
          lastname?: string;
        };
      };

      const t = (await tokenRes.json()) as StravaTokenResp;
      const stravaUserId = t.athlete.id.toString();
      const expiresAt = new Date(t.expires_at * 1000);

      // Pre-check so the provider_connected event can distinguish a first-time
      // connection from a re-auth (user disconnected & reconnected, or OAuth
      // re-grant of a still-active link). Without this the upsert would
      // obscure the difference and inflate first-connection funnel metrics.
      const existingIntegration = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId: authenticatedUserId, provider: 'STRAVA' } },
        select: { id: true },
      });
      const isReconnect = Boolean(existingIntegration);

      // TODO: Remove OauthToken dual-write once webhooks/sync workers and token
      // refresh helpers (strava-token.ts) are migrated to read from UserIntegration.
      // OauthToken stores plaintext tokens; UserIntegration uses AES-256-GCM encryption.
      await prisma.$transaction(async (tx) => {
        await tx.oauthToken.upsert({
          where: { userId_provider: { userId: authenticatedUserId, provider: 'strava' } },
          create: {
            userId: authenticatedUserId,
            provider: 'strava',
            accessToken: t.access_token,
            refreshToken: t.refresh_token,
            expiresAt,
          },
          update: {
            accessToken: t.access_token,
            refreshToken: t.refresh_token,
            expiresAt,
          },
        });

        await tx.userAccount.upsert({
          where: {
            provider_providerUserId: {
              provider: 'strava',
              providerUserId: stravaUserId,
            },
          },
          create: {
            userId: authenticatedUserId,
            provider: 'strava',
            providerUserId: stravaUserId,
          },
          update: {
            userId: authenticatedUserId,
          },
        });

        // Update User with stravaUserId
        await tx.user.update({
          where: { id: authenticatedUserId },
          data: { stravaUserId },
        });

        // UserIntegration upsert (encrypted tokens)
        await tx.userIntegration.upsert({
          where: { userId_provider: { userId: authenticatedUserId, provider: 'STRAVA' } },
          create: {
            userId: authenticatedUserId,
            provider: 'STRAVA',
            externalUserId: stravaUserId,
            accessTokenEnc: encrypt(t.access_token),
            refreshTokenEnc: encrypt(t.refresh_token),
            expiresAt,
            scopes: 'activity:read_all',
            connectedAt: new Date(),
          },
          update: {
            externalUserId: stravaUserId,
            accessTokenEnc: encrypt(t.access_token),
            refreshTokenEnc: encrypt(t.refresh_token),
            expiresAt,
            scopes: 'activity:read_all',
            revokedAt: null,
          },
        });
      });

      captureServerEvent(authenticatedUserId, 'provider_connected', { provider: 'strava', isReconnect });

      // Check if multiple providers are connected (for data source prompt)
      const userAccounts = await prisma.userAccount.findMany({
        where: { userId },
        select: { provider: true },
      });

      const hasGarmin = userAccounts.some((acc) => acc.provider === 'garmin');
      const hasStrava = userAccounts.some((acc) => acc.provider === 'strava');
      const bothConnected = hasGarmin && hasStrava;

      if (isMobileFlow && attemptId) {
        // Attempt already consumed atomically by consumeOAuthAttempt
        log.info({ userId, attemptId }, 'Strava OAuth callback success (mobile)');
        const params = new URLSearchParams({ status: 'success' });
        if (bothConnected) params.set('prompt', 'choose-source');
        return res.redirect(`/auth/strava/mobile/complete?${params.toString()}`);
      }

      // Web flow: clear cookies and redirect
      res.clearCookie('ll_strava_state', { path: '/' });

      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      const user = await prisma.user.findUnique({ where: { id: userId } });

      let redirectPath: string;
      if (!user?.onboardingCompleted) {
        redirectPath = '/onboarding?step=6';
      } else if (bothConnected) {
        redirectPath = '/settings?strava=connected&prompt=choose-source';
      } else {
        redirectPath = '/settings?strava=connected';
      }

      log.info({ userId }, 'Strava OAuth callback success (web)');
      return res.redirect(`${appBase.replace(/\/$/, '')}${redirectPath}`);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray(err.meta?.target) && err.meta.target.includes('stravaUserId')
      ) {
        log.warn({ userId, attemptId }, 'Strava account already linked to another user');
        return redirectError('account_already_linked');
      }
      log.error({ err, userId, attemptId }, 'Strava callback failed');
      return redirectError('internal_error');
    }
  }
);

// ---------------------------------------------------------------------------
// 4) Mobile completion page — deep link trampoline
// ---------------------------------------------------------------------------
r.get('/strava/mobile/complete', (req: Request, res: Response) => {
  const VALID_STATUSES = ['success', 'error'] as const;
  const VALID_REASONS = ['invalid_state', 'token_exchange_failed', 'account_already_linked', 'internal_error'] as const;
  const VALID_PROMPTS = ['choose-source'] as const;

  const rawStatus = req.query.status as string | undefined;
  const rawReason = req.query.reason as string | undefined;
  const rawPrompt = req.query.prompt as string | undefined;

  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus!) ? rawStatus! : 'error';
  const reason = (VALID_REASONS as readonly string[]).includes(rawReason!) ? rawReason! : undefined;
  const prompt = (VALID_PROMPTS as readonly string[]).includes(rawPrompt!) ? rawPrompt! : undefined;
  const scheme = process.env.MOBILE_DEEP_LINK_SCHEME || 'loamlogger';

  log.debug({ status, reason, prompt }, 'Rendering Strava mobile completion page');

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const extraParams: Record<string, string> = {};
  if (prompt) extraParams.prompt = prompt;

  res.send(renderOAuthCompletionPage({
    provider: 'Strava',
    status,
    reason,
    scheme,
    brandColor: '#fc4c02',
    extraParams,
  }));
});

// ---------------------------------------------------------------------------
// 5) Status — connection status for mobile UI
// ---------------------------------------------------------------------------
r.get('/strava/status', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const integration = await prisma.userIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'STRAVA' } },
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
      where: { userId_provider: { userId, provider: 'strava' } },
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
    log.error({ err, userId }, 'Failed to get Strava status');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 6/7) Disconnect — shared logic for POST (mobile) and DELETE (web)
// ---------------------------------------------------------------------------
async function handleStravaDisconnect(userId: string): Promise<boolean> {
  const revoked = await revokeStravaTokenForUser(userId);
  if (!revoked) {
    log.warn({ userId }, 'Strava token revocation failed, proceeding with local cleanup');
  }

  await prisma.$transaction(async (tx) => {
    await tx.userIntegration.updateMany({
      where: { userId, provider: 'STRAVA' },
      data: { revokedAt: new Date() },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true },
    });
    await tx.oauthToken.deleteMany({
      where: { userId, provider: 'strava' },
    });
    await tx.userAccount.deleteMany({
      where: { userId, provider: 'strava' },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        stravaUserId: null,
        ...(user?.activeDataSource === 'strava' ? { activeDataSource: null } : {}),
      },
    });
  });

  return revoked;
}

r.post('/strava/disconnect', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await handleStravaDisconnect(userId);
    log.info({ userId, revoked }, 'Strava disconnected (mobile)');
    return sendSuccess(res, { ok: true });
  } catch (err) {
    log.error({ err, userId }, 'Strava disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

r.delete<Empty, void, Empty>('/strava/disconnect', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await handleStravaDisconnect(userId);
    log.info({ userId, revoked }, 'Strava disconnected (web)');
    return res.status(200).json({ success: true });
  } catch (err) {
    log.error({ err, userId }, 'Strava disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

export default r;
