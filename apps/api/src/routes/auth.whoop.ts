import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { randomString } from '../lib/pcke';
import { sendBadRequest, sendUnauthorized, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';
import { revokeWhoopTokenForUser } from '../lib/whoop-token';
import { WHOOP_AUTH_URL, WHOOP_TOKEN_URL, type WhoopUserProfile } from '../types/whoop';

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
    return sendInternalError(res, `Missing env vars: ${missing}`);
  }

  const state = randomString(24);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const, // 'lax' allows cookies to be sent on top-level navigations (OAuth redirects)
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 10 * 60 * 1000,
    path: '/',
  };

  console.log('[WHOOP Start] Setting state cookie:', {
    state,
    cookieOptions,
    nodeEnv: process.env.NODE_ENV,
  });

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
    try {
      const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI;
      const CLIENT_ID = process.env.WHOOP_CLIENT_ID;
      const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;

      console.log('[WHOOP Callback] Environment check:', {
        hasRedirectUri: !!REDIRECT_URI,
        hasClientId: !!CLIENT_ID,
        hasClientSecret: !!CLIENT_SECRET,
      });

      if (!REDIRECT_URI || !CLIENT_ID || !CLIENT_SECRET) {
        const missing = [
          !REDIRECT_URI && 'WHOOP_REDIRECT_URI',
          !CLIENT_ID && 'WHOOP_CLIENT_ID',
          !CLIENT_SECRET && 'WHOOP_CLIENT_SECRET',
        ].filter(Boolean).join(', ');
        console.error('[WHOOP Callback] Missing env vars:', missing);
        return sendInternalError(res, `Missing env vars: ${missing}`);
      }

      const { code, state } = req.query;
      const cookieState = req.cookies['ll_whoop_state'];

      console.log('[WHOOP Callback] OAuth state check:', {
        hasCode: !!code,
        queryState: state,
        cookieState: cookieState,
        statesMatch: state === cookieState,
        allCookies: Object.keys(req.cookies),
      });

      if (!code || !state || !cookieState || state !== cookieState) {
        return sendBadRequest(res, 'Invalid OAuth state');
      }

      // Check for authenticated user
      const userId = req.user?.id || req.sessionUser?.uid;
      if (!userId) {
        return sendUnauthorized(res, 'No user - please log in first');
      }

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
        console.error('[WHOOP Callback] Token exchange failed:', text);
        return res.status(502).send(`Token exchange failed: ${text}`);
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

      console.log('[WHOOP Callback] Token received, expires at:', expiresAt);

      // Fetch user profile to get WHOOP user ID
      const profileRes = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
        headers: {
          Authorization: `Bearer ${t.access_token}`,
        },
      });

      if (!profileRes.ok) {
        const text = await profileRes.text();
        console.error('[WHOOP Callback] Profile fetch failed:', text);
        return res.status(502).send(`Profile fetch failed: ${text}`);
      }

      const profile = (await profileRes.json()) as WhoopUserProfile;
      const whoopUserId = profile.user_id.toString();

      console.log('[WHOOP Callback] WHOOP user ID:', whoopUserId);

      // Store OAuth token
      await prisma.oauthToken.upsert({
        where: { userId_provider: { userId, provider: 'whoop' } },
        create: {
          userId,
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

      // Store WHOOP user ID in UserAccount for identification
      await prisma.userAccount.upsert({
        where: {
          provider_providerUserId: {
            provider: 'whoop',
            providerUserId: whoopUserId,
          },
        },
        create: {
          userId,
          provider: 'whoop',
          providerUserId: whoopUserId,
        },
        update: {
          userId, // in case user reconnects to different account
        },
      });

      // Update User with whoopUserId
      await prisma.user.update({
        where: { id: userId },
        data: { whoopUserId },
      });

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

      console.log('[WHOOP Callback] Success! Redirecting to:', redirectPath);
      return res.redirect(`${appBase.replace(/\/$/, '')}${redirectPath}`);
    } catch (error) {
      logError('WHOOP Callback', error);
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      return res.redirect(
        `${appBase}/auth/error?message=${encodeURIComponent('WHOOP connection failed. Please try again.')}`
      );
    }
  }
);

/**
 * 3) Disconnect WHOOP account
 * Revokes OAuth token with WHOOP, then removes from database
 */
r.delete<Empty, void, Empty>('/whoop/disconnect', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return sendUnauthorized(res, 'Not authenticated');
  }

  try {
    // Revoke the token with WHOOP BEFORE deleting locally
    // This ensures the token is invalidated on WHOOP's servers
    const revoked = await revokeWhoopTokenForUser(userId);
    if (!revoked) {
      console.warn(`[WHOOP Disconnect] Token revocation failed for user ${userId}, proceeding with local cleanup`);
    }

    // Get user to check if WHOOP is the active source
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true },
    });

    // Delete tokens and account record, and clear activeDataSource if it was WHOOP
    await prisma.$transaction([
      prisma.oauthToken.deleteMany({
        where: {
          userId,
          provider: 'whoop',
        },
      }),
      prisma.userAccount.deleteMany({
        where: {
          userId,
          provider: 'whoop',
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          whoopUserId: null,
          ...(user?.activeDataSource === 'whoop' ? { activeDataSource: null } : {}),
        },
      }),
    ]);

    console.log(`[WHOOP Disconnect] User ${userId} disconnected WHOOP (token revoked: ${revoked})`);
    return res.status(200).json({ success: true });
  } catch (error) {
    logError('WHOOP Disconnect', error);
    return sendInternalError(res, 'Failed to disconnect');
  }
});

export default r;
