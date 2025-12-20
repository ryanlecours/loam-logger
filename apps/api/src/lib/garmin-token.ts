import { prisma } from './prisma';
import { addSeconds } from 'date-fns';

/**
 * Get a valid Garmin access token for a user
 * Automatically refreshes the token if it's expired
 */
export async function getValidGarminToken(userId: string): Promise<string | null> {
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'garmin',
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
    console.error('[Garmin Token] No refresh token available');
    return null;
  }

  try {
    const TOKEN_URL = process.env.GARMIN_TOKEN_URL;
    const CLIENT_ID = process.env.GARMIN_CLIENT_ID;

    if (!TOKEN_URL || !CLIENT_ID) {
      console.error('[Garmin Token] Missing GARMIN_TOKEN_URL or GARMIN_CLIENT_ID');
      return null;
    }

    console.log('[Garmin Token] Refreshing expired token for user:', userId);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: CLIENT_ID,
    });

    if (process.env.GARMIN_CLIENT_SECRET) {
      body.set('client_secret', process.env.GARMIN_CLIENT_SECRET);
    }

    const refreshRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      console.error(`[Garmin Token] Refresh failed: ${refreshRes.status} ${text}`);
      return null;
    }

    type TokenResp = {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const newTokens = (await refreshRes.json()) as TokenResp;
    const newExpiresAt = addSeconds(new Date(), newTokens.expires_in ?? 3600);

    // Update token in database
    await prisma.oauthToken.update({
      where: {
        userId_provider: {
          userId,
          provider: 'garmin',
        },
      },
      data: {
        accessToken: newTokens.access_token,
        expiresAt: newExpiresAt,
        ...(newTokens.refresh_token ? { refreshToken: newTokens.refresh_token } : {}),
      },
    });

    console.log('[Garmin Token] Token refreshed successfully');
    return newTokens.access_token;
  } catch (error) {
    console.error('[Garmin Token] Error refreshing token:', error);
    return null;
  }
}
