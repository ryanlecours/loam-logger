import { prisma } from './prisma';
import { logError } from './logger';

const STRAVA_DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize';

// Cache for in-flight refresh promises to prevent race conditions
// When multiple requests need a token refresh simultaneously, they share the same promise
// Stores { promise, timestamp } to enable timeout-based cleanup
interface CacheEntry {
  promise: Promise<string | null>;
  timestamp: number;
}
const refreshPromiseCache = new Map<string, CacheEntry>();

// Maximum time a refresh operation should take (30 seconds)
const REFRESH_TIMEOUT_MS = 30_000;

/**
 * Revoke a Strava access token
 * This invalidates the token on Strava's servers, not just locally.
 * Should be called before deleting tokens from the database.
 *
 * @param accessToken - The access token to revoke
 * @returns true if revocation succeeded (or token was already invalid), false on error
 */
export async function revokeStravaToken(accessToken: string): Promise<boolean> {
  try {
    console.log('[Strava Revoke] Revoking access token');

    const response = await fetch(STRAVA_DEAUTH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      console.log('[Strava Revoke] Token revoked successfully');
      return true;
    }

    // 401 means the token is already invalid/revoked - that's fine
    if (response.status === 401) {
      console.log('[Strava Revoke] Token already invalid/revoked');
      return true;
    }

    // Safely read error response body
    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '(failed to read response body)';
    }
    console.error(`[Strava Revoke] Failed: ${response.status} ${text}`);
    return false;
  } catch (error) {
    logError('Strava Token revocation', error);
    return false;
  }
}

/**
 * Revoke Strava token for a user by userId
 * Fetches the token from the database and revokes it.
 *
 * @param userId - The user's ID
 * @returns true if revocation succeeded (or no token found), false on error
 */
export async function revokeStravaTokenForUser(userId: string): Promise<boolean> {
  try {
    const token = await prisma.oauthToken.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: 'strava',
        },
      },
    });

    if (!token) {
      console.log('[Strava Revoke] No token found for user:', userId);
      return true; // No token to revoke
    }

    return await revokeStravaToken(token.accessToken);
  } catch (error) {
    logError('Strava Token revocation for user', error);
    return false;
  }
}

/**
 * Get a valid Strava access token for a user
 * Automatically refreshes the token if it's expired
 *
 * CRITICAL: Strava invalidates old refresh tokens when issuing new ones.
 * We must ALWAYS update BOTH accessToken AND refreshToken on refresh.
 *
 * Uses promise caching to prevent race conditions when multiple requests
 * trigger token refresh simultaneously.
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

  // Check if there's already a refresh in progress for this user
  // Note: There's a small race window between promise completion and finally block
  // where a second request might start a new refresh. This is acceptable as both
  // requests will get valid tokens, just with a redundant API call.
  const existingEntry = refreshPromiseCache.get(userId);
  if (existingEntry) {
    // Check if the cached promise has timed out (stale entry protection)
    const age = Date.now() - existingEntry.timestamp;
    if (age < REFRESH_TIMEOUT_MS) {
      console.log('[Strava Token] Waiting for existing refresh for user:', userId);
      return existingEntry.promise;
    }
    // Stale entry - remove it and proceed with new refresh
    console.warn(`[Strava Token] Removing stale cache entry for user: ${userId} (age: ${age}ms)`);
    refreshPromiseCache.delete(userId);
  }

  // Start a new refresh and cache the promise with timestamp
  const refreshPromise = refreshStravaToken(userId, token.refreshToken);
  refreshPromiseCache.set(userId, { promise: refreshPromise, timestamp: Date.now() });

  try {
    return await refreshPromise;
  } finally {
    // Clean up the cache entry when done (success or failure)
    refreshPromiseCache.delete(userId);
  }
}

/**
 * Internal function to perform the actual token refresh
 */
async function refreshStravaToken(userId: string, refreshToken: string): Promise<string | null> {
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
      refresh_token: refreshToken,
    });

    const refreshRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!refreshRes.ok) {
      let text = '';
      try {
        text = await refreshRes.text();
      } catch {
        text = '(failed to read response body)';
      }
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
    logError('Strava Token refresh', error);
    return null;
  }
}
