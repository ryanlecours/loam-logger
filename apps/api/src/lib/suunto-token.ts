// TODO: Migrate to read from UserIntegration (encrypted tokens) instead of
// OauthToken (plaintext). Once migrated, stop dual-writing to OauthToken in
// auth.suunto.ts and drop the OauthToken table. Mirrors strava-token.ts.
import { prisma } from './prisma';
import { createLogger } from './logger';
import type { SuuntoTokenResp } from './suunto-sync';

const log = createLogger('suunto-token');

const SUUNTO_TOKEN_URL = 'https://cloudapi-oauth.suunto.com/oauth/token';
const SUUNTO_DEAUTH_URL = 'https://cloudapi-oauth.suunto.com/oauth/deauthorize';

interface CacheEntry {
  promise: Promise<string | null>;
  timestamp: number;
}
const refreshPromiseCache = new Map<string, CacheEntry>();
const REFRESH_TIMEOUT_MS = 30_000;

setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of refreshPromiseCache.entries()) {
    if (now - entry.timestamp > REFRESH_TIMEOUT_MS) {
      log.warn({ userId }, 'Cleaning up stale cache entry');
      refreshPromiseCache.delete(userId);
    }
  }
}, 60_000).unref();

/**
 * Revoke Suunto access for a user via GET /oauth/deauthorize?client_id=...
 * The user's bearer token authenticates the request so Suunto knows whose
 * grant to revoke. A 401 means the token was already invalid — treat as
 * success so disconnect proceeds.
 */
export async function revokeSuuntoTokenForUser(userId: string): Promise<boolean> {
  try {
    const CLIENT_ID = process.env.SUUNTO_CLIENT_ID;
    if (!CLIENT_ID) {
      log.error('Missing SUUNTO_CLIENT_ID');
      return false;
    }

    const token = await prisma.oauthToken.findUnique({
      where: { userId_provider: { userId, provider: 'suunto' } },
    });
    if (!token) {
      log.info({ userId }, 'No token found for user');
      return true;
    }

    const url = `${SUUNTO_DEAUTH_URL}?client_id=${encodeURIComponent(CLIENT_ID)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    if (res.ok || res.status === 401) {
      log.info({ userId, status: res.status }, 'Suunto token revoked (or already invalid)');
      return true;
    }

    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch { body = '(unread)'; }
    log.error({ userId, status: res.status, body }, 'Suunto revoke failed');
    return false;
  } catch (err) {
    log.error({ err, userId }, 'Suunto revoke error');
    return false;
  }
}

export async function getValidSuuntoToken(userId: string): Promise<string | null> {
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'suunto',
      },
    },
  });

  if (!token) {
    return null;
  }

  const now = new Date();
  const expiryBuffer = new Date(token.expiresAt.getTime() - 5 * 60 * 1000);

  if (now < expiryBuffer) {
    return token.accessToken;
  }

  if (!token.refreshToken) {
    log.error({ userId }, 'No refresh token available');
    return null;
  }

  const existingEntry = refreshPromiseCache.get(userId);
  if (existingEntry) {
    const age = Date.now() - existingEntry.timestamp;
    if (age < REFRESH_TIMEOUT_MS) {
      log.debug({ userId }, 'Waiting for existing refresh');
      return existingEntry.promise;
    }
    log.warn({ userId, age }, 'Removing stale cache entry');
    refreshPromiseCache.delete(userId);
  }

  const refreshPromise = refreshSuuntoToken(userId, token.refreshToken);
  refreshPromiseCache.set(userId, { promise: refreshPromise, timestamp: Date.now() });

  try {
    return await refreshPromise;
  } finally {
    refreshPromiseCache.delete(userId);
  }
}

async function refreshSuuntoToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const CLIENT_ID = process.env.SUUNTO_CLIENT_ID;
    const CLIENT_SECRET = process.env.SUUNTO_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      log.error('Missing SUUNTO_CLIENT_ID or SUUNTO_CLIENT_SECRET');
      return null;
    }

    log.info({ userId }, 'Refreshing expired token');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const refreshRes = await fetch(SUUNTO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basicAuth}`,
      },
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

    const newTokens = (await refreshRes.json()) as SuuntoTokenResp;
    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    await prisma.oauthToken.update({
      where: {
        userId_provider: {
          userId,
          provider: 'suunto',
        },
      },
      data: {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresAt: newExpiresAt,
      },
    });

    log.info({ userId }, 'Token refreshed successfully');
    return newTokens.access_token;
  } catch (error) {
    log.error({ err: error, userId }, 'Token refresh error');
    return null;
  }
}
