/**
 * Garmin token lifecycle. All reads and writes go through the encrypted
 * `UserIntegration` store (see ./integration-tokens); nothing here touches the
 * legacy plaintext `OauthToken` table except `adoptLegacyPlaintextTokens`,
 * which exists only to migrate stragglers off it.
 */
import { prisma } from './prisma';
import { addSeconds } from 'date-fns';
import { createLogger } from './logger';
import { encrypt } from './crypto';
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
 * One-time adoption of a pre-encryption Garmin connection.
 *
 * Users who linked Garmin before `UserIntegration` existed have a plaintext
 * `OauthToken` row and no encrypted counterpart. Reading only the encrypted
 * store would silently disconnect them, so on first access we encrypt what we
 * find, write it to `UserIntegration`, and delete the plaintext row.
 *
 * This is the only remaining read of plaintext Garmin tokens. It is
 * self-limiting: every path that touches a token calls through here, so the
 * legacy rows drain as users sync. `scripts/migrate-garmin-tokens.ts` does the
 * same thing eagerly for accounts that never sync, after which this function
 * and the OauthToken Garmin rows can both be deleted.
 */
async function adoptLegacyPlaintextTokens(
  userId: string
): Promise<IntegrationTokens | null> {
  const legacy = await prisma.oauthToken.findUnique({
    where: { userId_provider: { userId, provider: 'garmin' } },
  });

  if (!legacy) return null;

  const account = await prisma.userAccount.findFirst({
    where: { userId, provider: 'garmin' },
    select: { providerUserId: true },
  });

  log.warn(
    { userId },
    'Adopting pre-encryption Garmin tokens into the encrypted store'
  );

  await prisma.$transaction(async (tx) => {
    await tx.userIntegration.upsert({
      where: { userId_provider: { userId, provider: 'GARMIN' } },
      create: {
        userId,
        provider: 'GARMIN',
        externalUserId: account?.providerUserId ?? null,
        accessTokenEnc: encrypt(legacy.accessToken),
        refreshTokenEnc: legacy.refreshToken ? encrypt(legacy.refreshToken) : null,
        expiresAt: legacy.expiresAt,
        connectedAt: legacy.createdAt,
      },
      // An integration row that exists but was unreadable (decrypt failure)
      // should not be clobbered by an older plaintext value; only fill gaps.
      update: {},
    });

    await tx.oauthToken.deleteMany({ where: { userId, provider: 'garmin' } });
  });

  return {
    accessToken: legacy.accessToken,
    refreshToken: legacy.refreshToken,
    expiresAt: legacy.expiresAt,
  };
}

/**
 * Read this user's Garmin tokens, migrating a legacy plaintext row if that is
 * all we have. Returns null when the user has no live Garmin connection.
 */
async function readGarminTokens(userId: string): Promise<IntegrationTokens | null> {
  const tokens = await getIntegrationTokens(userId, 'GARMIN');
  if (tokens) return tokens;

  // Adopt ONLY when no integration row exists at all. A row that exists but
  // yielded no tokens is revoked or undecryptable, and reviving it from a stale
  // plaintext row would undo a revocation — handing out credentials for a user
  // who withdrew consent. Getting this backwards is the whole risk of keeping a
  // fallback path, so it is checked explicitly rather than inferred.
  const existing = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId, provider: 'GARMIN' } },
    select: { id: true },
  });
  if (existing) return null;

  return adoptLegacyPlaintextTokens(userId);
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
