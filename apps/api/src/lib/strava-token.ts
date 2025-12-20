import { prisma } from './prisma';

/**
 * Get a valid Strava access token for a user
 * Automatically refreshes the token if it's expired
 *
 * CRITICAL: Strava invalidates old refresh tokens when issuing new ones.
 * We must ALWAYS update BOTH accessToken AND refreshToken on refresh.
 */
export async function getValidStravaToken(userId: string): Promise<string | null> {
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'strava',
      },
    },
  });

  if (!token) {
    return null;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiryBuffer = new Date(token.expiresAt.getTime() - 5 * 60 * 1000);

  if (now < expiryBuffer) {
    // Token is still valid
    return token.accessToken;
  }

  // Token is expired or about to expire, try to refresh it
  if (!token.refreshToken) {
    console.error('[Strava Token] No refresh token available');
    return null;
  }

  try {
    const TOKEN_URL = 'https://www.strava.com/oauth/token';
    const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
    const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('[Strava Token] Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET');
      return null;
    }

    console.log('[Strava Token] Refreshing expired token for user:', userId);

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });

    const refreshRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      console.error(`[Strava Token] Refresh failed: ${refreshRes.status} ${text}`);
      return null;
    }

    type StravaTokenResp = {
      access_token: string;
      refresh_token: string;
      expires_at: number; // Unix timestamp
      expires_in: number;
      token_type: string;
    };

    const newTokens = (await refreshRes.json()) as StravaTokenResp;
    const newExpiresAt = new Date(newTokens.expires_at * 1000);

    // CRITICAL: Update BOTH accessToken AND refreshToken
    // Strava invalidates the old refresh token when issuing a new one
    await prisma.oauthToken.update({
      where: {
        userId_provider: {
          userId,
          provider: 'strava',
        },
      },
      data: {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token, // MUST update this
        expiresAt: newExpiresAt,
      },
    });

    console.log('[Strava Token] Token refreshed successfully, expires at:', newExpiresAt);
    return newTokens.access_token;
  } catch (error) {
    console.error('[Strava Token] Error refreshing token:', error);
    return null;
  }
}
