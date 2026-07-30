/**
 * Garmin token lifecycle. All reads and writes go through the encrypted
 * `UserIntegration` store (see ./integration-tokens).
 *
 * Nothing here touches the legacy plaintext `OauthToken` table. It used to,
 * via an adopt-on-read fallback that encrypted a pre-encryption connection the
 * first time it was used; that path is gone now the migration has drained the
 * Garmin rows. The table itself remains, because Google, Strava, WHOOP and
 * Suunto still store their tokens there.
 */
import { addSeconds } from 'date-fns';
import { createLogger } from './logger';
import {
  getIntegrationTokens,
  saveIntegrationTokens,
  type IntegrationTokens,
} from './integration-tokens';

const log = createLogger('garmin-token');

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
      log.warn({ userId }, 'Cleaning up stale cache entry');
      refreshPromiseCache.delete(userId);
    }
  }
}, 60_000).unref(); // unref() allows process to exit even if timer is active

/**
 * Revoke a Garmin access token
 * This deregisters the user from Garmin's Health API, invalidating the token.
 * Should be called before deleting tokens from the database.
 *
 * Note: Garmin uses a deregistration endpoint rather than a standard OAuth revocation.
 * See: https://developer.garmin.com/gc-developer-program/health-api/
 *
 * @param accessToken - The access token to use for deregistration
 * @returns true if revocation succeeded (or token was already invalid), false on error
 */
export async function revokeGarminToken(accessToken: string): Promise<boolean> {
  try {
    const GARMIN_API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api';
    const deregistrationUrl = `${GARMIN_API_BASE}/rest/user/registration`;

    log.info('Deregistering user token');

    const response = await fetch(deregistrationUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (response.ok || response.status === 204) {
      log.info('Token revoked successfully');
      return true;
    }

    // 401/403 means the token is already invalid/revoked - that's fine
    if (response.status === 401 || response.status === 403) {
      log.info('Token already invalid/revoked');
      return true;
    }

    // Safely read error response body
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '(failed to read response body)';
    }
    log.error({ status: response.status, body }, 'Token revocation failed');
    return false;
  } catch (error) {
    log.error({ err: error }, 'Token revocation error');
    return false;
  }
}

/**
 * Revoke Garmin token for a user by userId
 * Fetches the token from the database and revokes it.
 *
 * @param userId - The user's ID
 * @returns true if revocation succeeded (or no token found), false on error
 */
export async function revokeGarminTokenForUser(userId: string): Promise<boolean> {
  try {
    const tokens = await readGarminTokens(userId);

    if (!tokens) {
      log.info({ userId }, 'No token found for user');
      return true; // No token to revoke
    }

    return await revokeGarminToken(tokens.accessToken);
  } catch (error) {
    log.error({ err: error, userId }, 'Token revocation for user failed');
    return false;
  }
}


/**
 * Read this user's Garmin tokens. Returns null when the user has no live
 * Garmin connection, which now includes a connection that was revoked or whose
 * ciphertext will not decrypt: both are states the encrypted store answers on
 * its own, with no second place to look.
 */
async function readGarminTokens(userId: string): Promise<IntegrationTokens | null> {
  return getIntegrationTokens(userId, 'GARMIN');
}

/**
 * Get a valid Garmin access token for a user
 * Automatically refreshes the token if it's expired
 *
 * Uses promise caching to prevent race conditions when multiple requests
 * trigger token refresh simultaneously.
 */
export async function getValidGarminToken(userId: string): Promise<string | null> {
  const token = await readGarminTokens(userId);

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
    log.error({ userId }, 'No refresh token available');
    return null;
  }

  // Check if there's already a refresh in progress for this user
  // Note: There's a small race window where concurrent requests could both start refreshes:
  // 1. Request A and B both await the DB lookup
  // 2. Request A finishes first, creates refresh promise, caches it
  // 3. Request A's refresh completes, finally block deletes cache entry
  // 4. Request B resumes, finds empty cache, starts another refresh
  // This is acceptable: both get valid tokens, just with a redundant API call.
  // A proper fix would require async mutex/locks, which adds complexity for minimal benefit.
  const existingEntry = refreshPromiseCache.get(userId);
  if (existingEntry) {
    // Check if the cached promise has timed out (stale entry protection)
    const age = Date.now() - existingEntry.timestamp;
    if (age < REFRESH_TIMEOUT_MS) {
      log.debug({ userId }, 'Waiting for existing refresh');
      return existingEntry.promise;
    }
    // Stale entry - remove it and proceed with new refresh
    log.warn({ userId, age }, 'Removing stale cache entry');
    refreshPromiseCache.delete(userId);
  }

  // Start a new refresh and cache the promise with timestamp
  const refreshPromise = refreshGarminToken(userId, token.refreshToken);
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
async function refreshGarminToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const TOKEN_URL = process.env.GARMIN_TOKEN_URL;
    const CLIENT_ID = process.env.GARMIN_CLIENT_ID;

    if (!TOKEN_URL || !CLIENT_ID) {
      log.error('Missing GARMIN_TOKEN_URL or GARMIN_CLIENT_ID');
      return null;
    }

    log.info({ userId }, 'Refreshing expired token');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
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
      let body = '';
      try {
        body = await refreshRes.text();
      } catch {
        body = '(failed to read response body)';
      }
      log.error({ status: refreshRes.status, userId, body }, 'Token refresh failed');
      return null;
    }

    type TokenResp = {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const newTokens = (await refreshRes.json()) as TokenResp;
    const newExpiresAt = addSeconds(new Date(), newTokens.expires_in ?? 3600);

    // Store re-encrypted. Garmin does not always return a new refresh token;
    // saveIntegrationTokens leaves the existing one alone when it is absent.
    await saveIntegrationTokens(userId, 'GARMIN', {
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token,
      expiresAt: newExpiresAt,
    });

    log.info({ userId }, 'Token refreshed successfully');
    return newTokens.access_token;
  } catch (error) {
    log.error({ err: error, userId }, 'Token refresh error');
    return null;
  }
}
