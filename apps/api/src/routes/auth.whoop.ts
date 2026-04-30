import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { randomString } from '../lib/pcke';
import { sendBadRequest, sendSuccess, sendUnauthorized, sendInternalError } from '../lib/api-response';
import { createLogger } from '../lib/logger';
import { revokeWhoopTokenForUser } from '../lib/whoop-token';
import { WHOOP_AUTH_URL, WHOOP_TOKEN_URL, type WhoopUserProfile } from '../types/whoop';
import { captureServerEvent } from '../lib/posthog';

const log = createLogger('whoop-oauth');

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * 1) Start OAuth — redirect user to WHOOP's consent page with state
 */
r.get<Empty, void, Empty>('/whoop/start', async (_req: Request, res: Response) => {
  const CLIENT_ID = process.env.WHOOP_CLIENT_ID;
  const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
  const SCOPE = 'read:workout read:profile offline';

  if (!CLIENT_ID || !REDIRECT_URI) {
    const missing = [
      !CLIENT_ID && 'WHOOP_CLIENT_ID',
      !REDIRECT_URI && 'WHOOP_REDIRECT_URI',
    ].filter(Boolean).join(', ');
    log.error({ missing }, 'Missing env vars for WHOOP start');
    return sendInternalError(res, 'WHOOP OAuth is not configured');
  }

  const state = randomString(24);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const, // 'lax' allows cookies to be sent on top-level navigations (OAuth redirects)
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 10 * 60 * 1000,
    path: '/',
  };

  log.debug({ state, cookieOptions, nodeEnv: process.env.NODE_ENV }, 'Setting WHOOP state cookie');

  // short-lived, httpOnly cookie for CSRF state
  res.cookie('ll_whoop_state', state, cookieOptions);

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);

  return res.redirect(url.toString());
});

/**
 * 2) Callback — exchange code for tokens, store in DB
 */
r.get<Empty, void, Empty, { code?: string; state?: string; scope?: string }>(
  '/whoop/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string; scope?: string }>, res: Response) => {
    let userId: string | undefined;
    try {
      const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
      const CLIENT_ID = process.env.WHOOP_CLIENT_ID;
      const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;

      log.debug({ hasRedirectUri: !!REDIRECT_URI, hasClientId: !!CLIENT_ID, hasClientSecret: !!CLIENT_SECRET }, 'WHOOP callback environment check');

      if (!REDIRECT_URI || !CLIENT_ID || !CLIENT_SECRET) {
        const missing = [
          !REDIRECT_URI && 'WHOOP_REDIRECT_URI',
          !CLIENT_ID && 'WHOOP_CLIENT_ID',
          !CLIENT_SECRET && 'WHOOP_CLIENT_SECRET',
        ].filter(Boolean).join(', ');
        log.error({ missing }, 'Missing env vars for WHOOP callback');
        return sendInternalError(res, 'WHOOP OAuth is not configured');
      }

      const { code, state } = req.query;
      const cookieState = req.cookies['ll_whoop_state'];

      log.debug({ hasCode: !!code, statesMatch: state === cookieState }, 'WHOOP callback state check');

      if (!code || !state || !cookieState || state !== cookieState) {
        return sendBadRequest(res, 'Invalid OAuth state');
      }

      // Check for authenticated user
      userId = req.user?.id || req.sessionUser?.uid;
      if (!userId) {
        return sendUnauthorized(res, 'No user - please log in first');
      }

      const authenticatedUserId = userId;

      // Token exchange (OAuth2 Authorization Code)
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      });

      const tokenRes = await fetch(WHOOP_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        log.error({ status: tokenRes.status, body: text.slice(0, 200) }, 'WHOOP token exchange failed');
        return res.status(502).send('Token exchange failed');
      }

      type WhoopTokenResp = {
        access_token: string;
        refresh_token: string;
        expires_in: number; // Seconds until expiration
        token_type: string;
        scope: string;
      };

      const t = (await tokenRes.json()) as WhoopTokenResp;
      const expiresAt = new Date(Date.now() + t.expires_in * 1000);

      log.info({ expiresAt }, 'WHOOP token received');

      // Fetch user profile to get WHOOP user ID
      const profileRes = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
        headers: {
          Authorization: `Bearer ${t.access_token}`,
        },
      });

      if (!profileRes.ok) {
        const text = await profileRes.text();
        log.error({ status: profileRes.status, body: text.slice(0, 200) }, 'WHOOP profile fetch failed');
        return res.status(502).send('Profile fetch failed');
      }

      const profile = (await profileRes.json()) as WhoopUserProfile;
      const whoopUserId = profile.user_id.toString();

      log.info({ whoopUserId }, 'WHOOP user ID fetched');

      // Pre-check so the provider_connected event can distinguish a first-time
      // connection from a re-auth. See auth.strava.ts for rationale. Whoop
      // doesn't populate a `UserIntegration` row like Strava/Garmin, so we
      // probe the `whoopUserId` column on `User` (set on connect, cleared
      // on disconnect).
      const priorUser = await prisma.user.findUnique({
        where: { id: authenticatedUserId },
        select: { whoopUserId: true },
      });
      const isReconnect = Boolean(priorUser?.whoopUserId);

      // Store OAuth token, user account, and whoopUserId atomically
      await prisma.$transaction(async (tx) => {
        await tx.oauthToken.upsert({
          where: { userId_provider: { userId: authenticatedUserId, provider: 'whoop' } },
          create: {
            userId: authenticatedUserId,
            provider: 'whoop',
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
              provider: 'whoop',
              providerUserId: whoopUserId,
            },
          },
          create: {
            userId: authenticatedUserId,
            provider: 'whoop',
            providerUserId: whoopUserId,
          },
          update: {
            userId: authenticatedUserId,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { whoopUserId },
        });
      });

      captureServerEvent(authenticatedUserId, 'provider_connected', { provider: 'whoop', isReconnect });

      // Check if user has multiple providers connected
      const userAccounts = await prisma.userAccount.findMany({
        where: { userId },
        select: { provider: true },
      });

      const hasGarmin = userAccounts.some((acc) => acc.provider === 'garmin');
      const hasStrava = userAccounts.some((acc) => acc.provider === 'strava');
      const hasWhoop = userAccounts.some((acc) => acc.provider === 'whoop');
      const multipleConnected = [hasGarmin, hasStrava, hasWhoop].filter(Boolean).length > 1;

      // Clear state cookie and redirect back to app
      res.clearCookie('ll_whoop_state', { path: '/' });

      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';

      // Check if user is in onboarding
      const user = await prisma.user.findUnique({ where: { id: userId } });

      let redirectPath: string;
      if (!user?.onboardingCompleted) {
        redirectPath = '/onboarding?step=6';
      } else if (multipleConnected) {
        // Prompt user to choose data source
        redirectPath = '/settings?whoop=connected&prompt=choose-source';
      } else {
        redirectPath = '/settings?whoop=connected';
      }

      log.info({ userId, redirectPath }, 'WHOOP OAuth callback success');
      return res.redirect(`${appBase.replace(/\/$/, '')}${redirectPath}`);
    } catch (error) {
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) && error.meta.target.includes('whoopUserId')
      ) {
        log.warn({ userId }, 'WHOOP account already linked to another user');
        return res.redirect(
          `${appBase}/auth/error?message=${encodeURIComponent('This WHOOP account is already linked to another user.')}`
        );
      }
      log.error({ err: error }, 'WHOOP callback error');
      return res.redirect(
        `${appBase}/auth/error?message=${encodeURIComponent('WHOOP connection failed. Please try again.')}`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Auth strategy for the routes below
// ---------------------------------------------------------------------------
// `req.sessionUser` is populated by the mobile bearer-token middleware;
// `req.user` is populated by the web session-cookie middleware. The two
// upstream auth flows are independent, so each route below picks the
// resolver that matches its caller.
//
// - `GET /whoop/status` and `POST /whoop/disconnect` are mobile-only
//   surfaces (the web app reads connection state via its own data path
//   and disconnects via DELETE), so they only consult `req.sessionUser`.
// - `DELETE /whoop/disconnect` is the web's path but falls back to
//   `req.sessionUser` to keep it usable from a mobile client too — no
//   reason to gate it.
//
// Mirrors the Suunto pattern in auth.suunto.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3) Status — connection status for mobile UI
// ---------------------------------------------------------------------------
// WHOOP doesn't use the `UserIntegration` table (see comment in callback);
// connection state lives in `oauthToken` keyed on (userId, provider='whoop').
// Presence of that row is the single source of truth — same row the
// disconnect handler below clears.
//
// The response payload is intentionally narrower than Suunto/Garmin/Strava
// status: `OauthToken` doesn't carry `revokedAt`, `lastSyncAt`, or `scopes`
// columns (those live on `UserIntegration`, which WHOOP doesn't populate).
// We omit those fields rather than emit hardcoded `null`s — the mobile
// `IntegrationStatus` type already declares them optional, and explicit
// nulls would falsely suggest the data is "available but currently empty"
// when it doesn't exist anywhere in our schema.
r.get('/whoop/status', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // `select` scoped to only the column we render. Without it Prisma
    // pulls `accessToken` and `refreshToken` (sensitive credential
    // material) into the API process's memory — unnecessary for a status
    // check, and a free way to reduce the data those fields could leak
    // into via stack traces, error-path logs, or future debug breakpoints.
    const oauthToken = await prisma.oauthToken.findUnique({
      where: { userId_provider: { userId, provider: 'whoop' } },
      select: { createdAt: true },
    });

    if (oauthToken) {
      return sendSuccess(res, {
        connected: true,
        connectedAt: oauthToken.createdAt.toISOString(),
      });
    }

    return sendSuccess(res, { connected: false });
  } catch (err) {
    log.error({ err, userId }, 'Failed to get WHOOP status');
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// 4/5) Disconnect — shared logic for POST (mobile) and DELETE (web)
// ---------------------------------------------------------------------------
async function handleWhoopDisconnect(userId: string): Promise<boolean> {
  // Revoke the token with WHOOP BEFORE deleting locally so the token is
  // invalidated on WHOOP's servers even if the local cleanup fails.
  const revoked = await revokeWhoopTokenForUser(userId);
  if (!revoked) {
    log.warn({ userId }, 'WHOOP token revocation failed, proceeding with local cleanup');
  }

  // Atomic-ish cleanup. The pre-refactor code did a `findUnique` of
  // `activeDataSource` outside the transaction, then conditionally set it to
  // null inside — a TOCTOU window where a concurrent request (e.g. user
  // toggling data source from another device) could change the value
  // between read and write, leaving stale state.
  //
  // Replaced with a SQL-level conditional: an `updateMany` whose `where`
  // clause includes `activeDataSource: 'whoop'` runs as a single statement
  // and only writes the row if the value is still 'whoop' at execution
  // time. Two separate writes — `whoopUserId` always cleared on the user,
  // `activeDataSource` cleared only if it still points at WHOOP.
  await prisma.$transaction([
    prisma.oauthToken.deleteMany({
      where: { userId, provider: 'whoop' },
    }),
    prisma.userAccount.deleteMany({
      where: { userId, provider: 'whoop' },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { whoopUserId: null },
    }),
    prisma.user.updateMany({
      where: { id: userId, activeDataSource: 'whoop' },
      data: { activeDataSource: null },
    }),
  ]);

  return revoked;
}

r.post('/whoop/disconnect', async (req: Request, res: Response) => {
  const userId = req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await handleWhoopDisconnect(userId);
    log.info({ userId, revoked }, 'WHOOP disconnected (mobile)');
    return sendSuccess(res);
  } catch (err) {
    log.error({ err, userId }, 'WHOOP disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

// CONTRACT CHANGE (this PR): the response body shape changed from
// `{ success: true }` to `{ ok: true }`. This is an intentional unification
// with the new POST /whoop/disconnect — both verbs now return the canonical
// `sendSuccess` envelope so callers don't have to branch on the field name.
//
// Audited consumers before changing:
//   - Web: apps/web/src/pages/Settings/sections/DataSourcesSection.tsx
//     `runDisconnect` only checks `res.ok` (HTTP status), never reads the
//     body field. Safe.
//   - Mobile: src/api/integrations.ts `disconnectIntegration` only checks
//     `response.ok` and parses errors from `response.json()`; the success
//     body is ignored. Safe.
//
// If a future external consumer relies on `{ success: true }`, surface
// that in the PR description / changelog before merging this rename.
r.delete<Empty, void, Empty>('/whoop/disconnect', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    const revoked = await handleWhoopDisconnect(userId);
    log.info({ userId, revoked }, 'WHOOP disconnected (web)');
    return sendSuccess(res);
  } catch (err) {
    log.error({ err, userId }, 'WHOOP disconnect failed');
    return sendInternalError(res, 'Failed to disconnect');
  }
});

export default r;
