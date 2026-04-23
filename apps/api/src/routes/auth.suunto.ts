import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { decodeJwt } from 'jose';
import { prisma } from '../lib/prisma';
import { randomString } from '../lib/pcke';
import { sendBadRequest, sendUnauthorized, sendInternalError, sendSuccess, sendTooManyRequests } from '../lib/api-response';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { createLogger } from '../lib/logger';
import { revokeSuuntoTokenForUser } from '../lib/suunto-token';
import { createOAuthAttempt, consumeOAuthAttempt } from '../lib/oauthState';
import { encrypt } from '../lib/crypto';
import { renderOAuthCompletionPage } from '../lib/oauthCompletionPage';
import { captureServerEvent } from '../lib/posthog';

const log = createLogger('suunto-oauth');

type Empty = Record<string, never>;
const r: Router = createRouter();

const AUTH_URL = 'https://cloudapi-oauth.suunto.com/oauth/authorize';
const TOKEN_URL = 'https://cloudapi-oauth.suunto.com/oauth/token';
const SCOPE = 'workout';

// Suunto's JWT access tokens carry a `user` claim holding the username; we use
// that as the providerUserId. We rely on TLS to Suunto's token endpoint for
// authenticity — if an attacker ever controls the token-exchange response
// (SSRF, rogue proxy, etc.) they could inject an arbitrary `user` claim here.
//
// We use `jose.decodeJwt` for structural validation (proper header.payload.sig
// shape, valid base64url, JSON body) rather than hand-rolled parsing — safer
// against malformed inputs without changing the trust model.
//
// TODO: upgrade to full signature verification (`jose.jwtVerify` with a
// JWKS via `createRemoteJWKSet`) if/when Suunto publishes a JWKS endpoint.
// None is documented as of the public Cloud API docs.
function extractSuuntoUsername(accessToken: string): string | null {
  try {
    const payload = decodeJwt(accessToken) as { user?: unknown };
    return typeof payload.user === 'string' && payload.user.length > 0
      ? payload.user
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1) Web Start
// ---------------------------------------------------------------------------
r.get<Empty, void, Empty>('/suunto/start', async (_req: Request, res: Response) => {
  const CLIENT_ID = process.env.SUUNTO_CLIENT_ID;
  const REDIRECT_URI = process.env.SUUNTO_REDIRECT_URI;

  if (!CLIENT_ID || !REDIRECT_URI) {
    const missing = [
      !CLIENT_ID && 'SUUNTO_CLIENT_ID',
      !REDIRECT_URI && 'SUUNTO_REDIRECT_URI',
    ].filter(Boolean).join(', ');
    log.error({ missing }, 'Missing env vars for Suunto start (web)');
    return sendInternalError(res, 'Suunto OAuth is not configured');
  }

  const state = randomString(24);

  res.cookie('ll_suunto_state', state, {
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
// 2) Mobile Start
// ---------------------------------------------------------------------------
r.post<Empty, unknown, Empty>('/suunto/start', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  const rateLimit = await checkMutationRateLimit('oauthStart', userId);
  if (!rateLimit.allowed) {
    return sendTooManyRequests(res, 'Too many OAuth attempts. Please try again later.', rateLimit.retryAfter);
  }

  const CLIENT_ID = process.env.SUUNTO_CLIENT_ID;
  const REDIRECT_URI = process.env.SUUNTO_REDIRECT_URI;

  if (!CLIENT_ID || !REDIRECT_URI) {
    const missing = [
      !CLIENT_ID && 'SUUNTO_CLIENT_ID',
      !REDIRECT_URI && 'SUUNTO_REDIRECT_URI',
    ].filter(Boolean).join(', ');
    log.error({ missing }, 'Missing env vars for Suunto start (mobile)');
    return sendInternalError(res, 'Suunto OAuth is not configured');
  }

  try {
    const { state, attempt } = await createOAuthAttempt({
      userId,
      provider: 'SUUNTO',
      platform: 'MOBILE',
      includeVerifier: false,
    });

    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', state);

    log.info({ userId, attemptId: attempt.id, provider: 'SUUNTO' }, 'Suunto OAuth start (mobile)');
    return sendSuccess(res, { authorizeUrl: url.toString() });
  } catch (err) {
    log.error({ err, userId }, 'Failed to create Suunto OAuth attempt');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 3) Callback
// ---------------------------------------------------------------------------
r.get<Empty, void, Empty, { code?: string; state?: string }>(
  '/suunto/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string }>, res: Response) => {
    let userId: string | undefined;
    let isMobileFlow = false;
    let attemptId: string | undefined;

    const { code, state } = req.query;

    function redirectError(reason: string) {
      if (isMobileFlow) {
        return res.redirect(`/auth/suunto/mobile/complete?status=error&reason=${encodeURIComponent(reason)}`);
      }
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      const message = reason === 'account_already_linked'
        ? 'This Suunto account is already linked to another user.'
        : 'Suunto connection failed. Please try again.';
      return res.redirect(
        `${appBase}/auth/error?message=${encodeURIComponent(message)}`
      );
    }

    try {
      const CLIENT_ID = process.env.SUUNTO_CLIENT_ID;
      const CLIENT_SECRET = process.env.SUUNTO_CLIENT_SECRET;
      const REDIRECT_URI = process.env.SUUNTO_REDIRECT_URI;

      if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
        const missing = [
          !CLIENT_ID && 'SUUNTO_CLIENT_ID',
          !CLIENT_SECRET && 'SUUNTO_CLIENT_SECRET',
          !REDIRECT_URI && 'SUUNTO_REDIRECT_URI',
        ].filter(Boolean).join(', ');
        log.error({ missing }, 'Missing env vars for Suunto callback');
        return sendInternalError(res, 'Suunto OAuth is not configured');
      }

      if (!code || !state) {
        return sendBadRequest(res, 'Missing code or state');
      }

      const dbAttempt = await consumeOAuthAttempt({ state, provider: 'SUUNTO' });
      if (dbAttempt) {
        isMobileFlow = true;
        userId = dbAttempt.attempt.userId;
        attemptId = dbAttempt.attempt.id;
        log.info({ userId, attemptId }, 'Suunto callback: mobile flow (DB state)');
      } else {
        const cookieState = req.cookies['ll_suunto_state'];
        if (!cookieState || state !== cookieState) {
          log.warn({ hasState: !!cookieState, statesMatch: state === cookieState }, 'Suunto callback: invalid state');
          return redirectError('invalid_state');
        }
        userId = req.user?.id || req.sessionUser?.uid;
        log.info({ userId }, 'Suunto callback: web flow (cookie state)');
      }

      if (!userId) {
        log.warn('Suunto callback: no authenticated user');
        return redirectError('invalid_state');
      }

      const authenticatedUserId = userId;

      // Token exchange (Authorization Code, no PKCE).
      // Suunto requires HTTP Basic auth with client_id:client_secret per RFC7617;
      // the form body must NOT contain the client credentials.
      const body = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      });

      const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basicAuth}`,
        },
        body,
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        log.error({ status: tokenRes.status, userId, attemptId, body: body.slice(0, 200) }, 'Suunto token exchange failed');
        return redirectError('token_exchange_failed');
      }

      type SuuntoTokenResp = {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        scope?: string;
      };

      const t = (await tokenRes.json()) as SuuntoTokenResp;
      const suuntoUsername = extractSuuntoUsername(t.access_token);
      if (!suuntoUsername) {
        log.error({ userId }, 'Failed to extract user claim from Suunto JWT');
        return redirectError('token_exchange_failed');
      }
      const expiresAt = new Date(Date.now() + t.expires_in * 1000);

      const existingIntegration = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId: authenticatedUserId, provider: 'SUUNTO' } },
        select: { id: true },
      });
      const isReconnect = Boolean(existingIntegration);

      // TODO: Remove OauthToken dual-write once webhooks/token helpers are
      // migrated to read from UserIntegration. Matches strava-token.ts plan.
      await prisma.$transaction(async (tx) => {
        await tx.oauthToken.upsert({
          where: { userId_provider: { userId: authenticatedUserId, provider: 'suunto' } },
          create: {
            userId: authenticatedUserId,
            provider: 'suunto',
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
              provider: 'suunto',
              providerUserId: suuntoUsername,
            },
          },
          create: {
            userId: authenticatedUserId,
            provider: 'suunto',
            providerUserId: suuntoUsername,
          },
          update: {
            userId: authenticatedUserId,
          },
        });

        await tx.user.update({
          where: { id: authenticatedUserId },
          data: { suuntoUserId: suuntoUsername },
        });

        await tx.userIntegration.upsert({
          where: { userId_provider: { userId: authenticatedUserId, provider: 'SUUNTO' } },
          create: {
            userId: authenticatedUserId,
            provider: 'SUUNTO',
            externalUserId: suuntoUsername,
            accessTokenEnc: encrypt(t.access_token),
            refreshTokenEnc: encrypt(t.refresh_token),
            expiresAt,
            scopes: t.scope ?? SCOPE,
            connectedAt: new Date(),
          },
          update: {
            externalUserId: suuntoUsername,
            accessTokenEnc: encrypt(t.access_token),
            refreshTokenEnc: encrypt(t.refresh_token),
            expiresAt,
            scopes: t.scope ?? SCOPE,
            revokedAt: null,
          },
        });
      });

      captureServerEvent(authenticatedUserId, 'provider_connected', { provider: 'suunto', isReconnect });

      if (isMobileFlow && attemptId) {
        log.info({ userId, attemptId }, 'Suunto OAuth callback success (mobile)');
        return res.redirect(`/auth/suunto/mobile/complete?status=success`);
      }

      res.clearCookie('ll_suunto_state', { path: '/' });

      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      const user = await prisma.user.findUnique({ where: { id: userId } });

      const redirectPath = !user?.onboardingCompleted
        ? '/onboarding?step=6'
        : '/settings?suunto=connected';

      log.info({ userId }, 'Suunto OAuth callback success (web)');
      return res.redirect(`${appBase.replace(/\/$/, '')}${redirectPath}`);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray(err.meta?.target) && err.meta.target.includes('suuntoUserId')
      ) {
        log.warn({ userId, attemptId }, 'Suunto account already linked to another user');
        return redirectError('account_already_linked');
      }
      log.error({ err, userId, attemptId }, 'Suunto callback failed');
      return redirectError('internal_error');
    }
  }
);

// ---------------------------------------------------------------------------
// 4) Mobile completion page — deep link trampoline
// ---------------------------------------------------------------------------
r.get('/suunto/mobile/complete', (req: Request, res: Response) => {
  const VALID_STATUSES = ['success', 'error'] as const;
  const VALID_REASONS = ['invalid_state', 'token_exchange_failed', 'account_already_linked', 'internal_error'] as const;

  const rawStatus = req.query.status as string | undefined;
  const rawReason = req.query.reason as string | undefined;

  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus!) ? rawStatus! : 'error';
  const reason = (VALID_REASONS as readonly string[]).includes(rawReason!) ? rawReason! : undefined;
  const scheme = process.env.MOBILE_DEEP_LINK_SCHEME || 'loamlogger';

  log.debug({ status, reason }, 'Rendering Suunto mobile completion page');

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  res.send(renderOAuthCompletionPage({
    provider: 'Suunto',
    status,
    reason,
    scheme,
    brandColor: '#0072ce',
  }));
});

// ---------------------------------------------------------------------------
// 5) Status
// ---------------------------------------------------------------------------
r.get('/suunto/status', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const integration = await prisma.userIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'SUUNTO' } },
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

    const oauthToken = await prisma.oauthToken.findUnique({
      where: { userId_provider: { userId, provider: 'suunto' } },
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
    log.error({ err, userId }, 'Failed to get Suunto status');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 6/7) Disconnect — shared logic for POST (mobile) and DELETE (web)
// ---------------------------------------------------------------------------
async function handleSuuntoDisconnect(userId: string): Promise<boolean> {
  const revoked = await revokeSuuntoTokenForUser(userId);
  if (!revoked) {
    log.warn({ userId }, 'Suunto token revocation failed, proceeding with local cleanup');
  }

  await prisma.$transaction(async (tx) => {
    await tx.userIntegration.updateMany({
      where: { userId, provider: 'SUUNTO' },
      data: { revokedAt: new Date() },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true },
    });
    await tx.oauthToken.deleteMany({
      where: { userId, provider: 'suunto' },
    });
    await tx.userAccount.deleteMany({
      where: { userId, provider: 'suunto' },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        suuntoUserId: null,
        ...(user?.activeDataSource === 'suunto' ? { activeDataSource: null } : {}),
      },
    });
  });

  return revoked;
}

r.post('/suunto/disconnect', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await handleSuuntoDisconnect(userId);
    log.info({ userId, revoked }, 'Suunto disconnected (mobile)');
    return sendSuccess(res, { ok: true });
  } catch (err) {
    log.error({ err, userId }, 'Suunto disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

r.delete<Empty, void, Empty>('/suunto/disconnect', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await handleSuuntoDisconnect(userId);
    log.info({ userId, revoked }, 'Suunto disconnected (web)');
    return res.status(200).json({ success: true });
  } catch (err) {
    log.error({ err, userId }, 'Suunto disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

export default r;
