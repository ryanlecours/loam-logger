import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { randomString } from '../lib/pcke.ts';
import { addSeconds } from 'date-fns';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * 1) Start OAuth — redirect user to Strava's consent page with state
 */
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
    return res.status(500).send(`Missing env vars: ${missing}`);
  }

  const state = randomString(24);

  const cookieOptions = {
    httpOnly: true,
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: 10 * 60 * 1000,
    path: '/',
  };

  console.log('[Strava Start] Setting state cookie:', {
    state,
    cookieOptions,
    nodeEnv: process.env.NODE_ENV,
  });

  // short-lived, httpOnly cookie for CSRF state
  res.cookie('ll_strava_state', state, cookieOptions);

  const url = new URL(AUTH_URL);
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
  '/strava/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string; scope?: string }>, res: Response) => {
    try {
      const TOKEN_URL = 'https://www.strava.com/oauth/token';
      const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
      const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
      const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

      console.log('[Strava Callback] Environment check:', {
        hasRedirectUri: !!REDIRECT_URI,
        hasClientId: !!CLIENT_ID,
        hasClientSecret: !!CLIENT_SECRET,
      });

      if (!REDIRECT_URI || !CLIENT_ID || !CLIENT_SECRET) {
        const missing = [
          !REDIRECT_URI && 'STRAVA_REDIRECT_URI',
          !CLIENT_ID && 'STRAVA_CLIENT_ID',
          !CLIENT_SECRET && 'STRAVA_CLIENT_SECRET',
        ].filter(Boolean).join(', ');
        console.error('[Strava Callback] Missing env vars:', missing);
        return res.status(500).send(`Missing env vars: ${missing}`);
      }

      const { code, state } = req.query;
      const cookieState = req.cookies['ll_strava_state'];

      console.log('[Strava Callback] OAuth state check:', {
        hasCode: !!code,
        queryState: state,
        cookieState: cookieState,
        statesMatch: state === cookieState,
        allCookies: Object.keys(req.cookies),
      });

      if (!code || !state || !cookieState || state !== cookieState) {
        return res.status(400).send('Invalid OAuth state');
      }

      // Check for authenticated user
      const userId = req.user?.id || req.sessionUser?.uid;
      if (!userId) {
        return res.status(401).send('No user - please log in first');
      }

      // Token exchange (OAuth2 Authorization Code)
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
        const text = await tokenRes.text();
        console.error('[Strava Callback] Token exchange failed:', text);
        return res.status(502).send(`Token exchange failed: ${text}`);
      }

      type StravaTokenResp = {
        access_token: string;
        refresh_token: string;
        expires_at: number; // Unix timestamp
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
      const expiresAt = new Date(t.expires_at * 1000); // Convert Unix timestamp to Date

      console.log('[Strava Callback] Token received, expires at:', expiresAt);
      console.log('[Strava Callback] Strava athlete ID:', stravaUserId);

      // Store OAuth token
      await prisma.oauthToken.upsert({
        where: { userId_provider: { userId, provider: 'strava' } },
        create: {
          userId,
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

      // Store Strava athlete ID in UserAccount for webhook identification
      await prisma.userAccount.upsert({
        where: {
          provider_providerUserId: {
            provider: 'strava',
            providerUserId: stravaUserId,
          },
        },
        create: {
          userId,
          provider: 'strava',
          providerUserId: stravaUserId,
        },
        update: {
          userId, // in case user reconnects to different account
        },
      });

      // Update User with stravaUserId for webhook identification
      await prisma.user.update({
        where: { id: userId },
        data: { stravaUserId },
      });

      // Check if user has both Garmin and Strava connected
      const userAccounts = await prisma.userAccount.findMany({
        where: { userId },
        select: { provider: true },
      });

      const hasGarmin = userAccounts.some((acc) => acc.provider === 'garmin');
      const hasStrava = userAccounts.some((acc) => acc.provider === 'strava');
      const bothConnected = hasGarmin && hasStrava;

      // Clear state cookie and redirect back to app
      res.clearCookie('ll_strava_state', { path: '/' });

      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';

      // Check if user is in onboarding
      const user = await prisma.user.findUnique({ where: { id: userId } });

      let redirectPath: string;
      if (!user?.onboardingCompleted) {
        redirectPath = '/onboarding?step=5';
      } else if (bothConnected) {
        // Prompt user to choose data source
        redirectPath = '/settings?strava=connected&prompt=choose-source';
      } else {
        redirectPath = '/settings?strava=connected';
      }

      console.log('[Strava Callback] Success! Redirecting to:', redirectPath);
      return res.redirect(`${appBase.replace(/\/$/, '')}${redirectPath}`);
    } catch (error) {
      console.error('[Strava Callback] Error:', error);
      const appBase = process.env.APP_BASE_URL ?? 'http://localhost:5173';
      return res.redirect(
        `${appBase}/auth/error?message=${encodeURIComponent('Strava connection failed. Please try again.')}`
      );
    }
  }
);

/**
 * 3) Disconnect Strava account
 * Removes OAuth tokens and UserAccount record
 */
r.delete<Empty, void, Empty>('/strava/disconnect', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Get user to check if Strava is the active source
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true },
    });

    // Delete tokens and account record, and clear activeDataSource if it was Strava
    await prisma.$transaction([
      prisma.oauthToken.deleteMany({
        where: {
          userId,
          provider: 'strava',
        },
      }),
      prisma.userAccount.deleteMany({
        where: {
          userId,
          provider: 'strava',
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          stravaUserId: null,
          ...(user?.activeDataSource === 'strava' ? { activeDataSource: null } : {}),
        },
      }),
    ]);

    console.log(`[Strava Disconnect] User ${userId} disconnected Strava`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Strava Disconnect] Error:', error);
    return res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default r;
