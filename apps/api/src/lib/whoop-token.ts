import { prisma } from './prisma';
import { logError } from './logger';
import { WHOOP_TOKEN_URL } from '../types/whoop';

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

// Periodic cleanup of stale cache entries to prevent memory leaks
// Runs every 60 seconds to remove entries older than REFRESH_TIMEOUT_MS
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of refreshPromiseCache.entries()) {
    if (now - entry.timestamp > REFRESH_TIMEOUT_MS) {
      console.warn(`[WHOOP Token] Cleaning up stale cache entry for user: ${userId}`);
      refreshPromiseCache.delete(userId);
    }
  }
}, 60_000).unref(); // unref() allows process to exit even if timer is active

/**
 * Revoke a WHOOP access token
 * This invalidates the token on WHOOP's servers, not just locally.
 * Should be called before deleting tokens from the database.
 *
 * @param accessToken - The access token to revoke
 * @returns true if revocation succeeded (or token was already invalid), false on error
 */
export async function revokeWhoopToken(accessToken: string): Promise<boolean> {
  try {
    console.log('[WHOOP Revoke] Revoking access token');

    // WHOOP uses the token URL with a revoke action
    // POST to token endpoint with token_type_hint=access_token
    const response = await fetch(`${WHOOP_TOKEN_URL}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: accessToken,
        token_type_hint: 'access_token',
        client_id: process.env.WHOOP_CLIENT_ID || '',
        client_secret: process.env.WHOOP_CLIENT_SECRET || '',
      }),
    });

    if (response.ok) {
      console.log('[WHOOP Revoke] Token revoked successfully');
      return true;
    }

    // 401 means the token is already invalid/revoked - that's fine
    if (response.status === 401) {
      console.log('[WHOOP Revoke] Token already invalid/revoked');
      return true;
    }

    // Safely read error response body
    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '(failed to read response body)';
    }
    console.error(`[WHOOP Revoke] Failed: ${response.status} ${text}`);
    return false;
  } catch (error) {
    logError('WHOOP Token revocation', error);
    return false;
  }
}

/**
 * Revoke WHOOP token for a user by userId
 * Fetches the token from the database and revokes it.
 *
 * @param userId - The user's ID
 * @returns true if revocation succeeded (or no token found), false on error
 */
export async function revokeWhoopTokenForUser(userId: string): Promise<boolean> {
  try {
    const token = await prisma.oauthToken.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: 'whoop',
        },
      },
    });

    if (!token) {
      console.log('[WHOOP Revoke] No token found for user:', userId);
      return true; // No token to revoke
    }

    return await revokeWhoopToken(token.accessToken);
  } catch (error) {
    logError('WHOOP Token revocation for user', error);
    return false;
  }
}

/**
 * Get a valid WHOOP access token for a user
 * Automatically refreshes the token if it's expired
 *
 * CRITICAL: WHOOP invalidates old refresh tokens when issuing new ones.
 * We must ALWAYS update BOTH accessToken AND refreshToken on refresh.
 *
 * Uses promise caching to prevent race conditions when multiple requests
 * trigger token refresh simultaneously.
 */
export async function getValidWhoopToken(userId: string): Promise<string | null> {
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'whoop',
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
    console.error('[WHOOP Token] No refresh token available');
    return null;
  }

  // Check if there's already a refresh in progress for this user
  const existingEntry = refreshPromiseCache.get(userId);
  if (existingEntry) {
    // Check if the cached promise has timed out (stale entry protection)
    const age = Date.now() - existingEntry.timestamp;
    if (age < REFRESH_TIMEOUT_MS) {
      console.log('[WHOOP Token] Waiting for existing refresh for user:', userId);
      return existingEntry.promise;
    }
    // Stale entry - remove it and proceed with new refresh
    console.warn(`[WHOOP Token] Removing stale cache entry for user: ${userId} (age: ${age}ms)`);
    refreshPromiseCache.delete(userId);
  }

  // Start a new refresh and cache the promise with timestamp
  const refreshPromise = refreshWhoopToken(userId, token.refreshToken);
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
async function refreshWhoopToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const CLIENT_ID = process.env.WHOOP_CLIENT_ID;
    const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('[WHOOP Token] Missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET');
      return null;
    }

    console.log('[WHOOP Token] Refreshing expired token for user:', userId);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'offline',
    });

    const refreshRes = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!refreshRes.ok) {
      let text = '';
      try {
        text = await refreshRes.text();
      } catch {
        text = '(failed to read response body)';
      }
      console.error(`[WHOOP Token] Refresh failed: ${refreshRes.status} ${text}`);
      return null;
    }

    type WhoopTokenResp = {
      access_token: string;
      refresh_token: string;
      expires_in: number; // Seconds until expiration
      token_type: string;
      scope: string;
    };

    const newTokens = (await refreshRes.json()) as WhoopTokenResp;
    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    // CRITICAL: Update BOTH accessToken AND refreshToken
    // WHOOP invalidates the old refresh token when issuing a new one
    await prisma.oauthToken.update({
      where: {
        userId_provider: {
          userId,
          provider: 'whoop',
        },
      },
      data: {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token, // MUST update this
        expiresAt: newExpiresAt,
      },
    });

    console.log('[WHOOP Token] Token refreshed successfully, expires at:', newExpiresAt);
    return newTokens.access_token;
  } catch (error) {
    logError('WHOOP Token refresh', error);
    return null;
  }
}
