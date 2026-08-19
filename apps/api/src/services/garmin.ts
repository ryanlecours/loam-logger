// src/services/garmin.ts
//
// Thin Garmin API client used only by the development-only debug router
// (routes/garmin.test.ts, mounted only when config.isProduction is false).
//
// This file used to carry its own token read/refresh/persist implementation
// against the plaintext `OauthToken` table — a second, divergent copy of what
// lib/garmin-token.ts already does. It now delegates to that canonical module,
// which reads and writes AES-256-GCM-encrypted tokens via `UserIntegration`.
// Keeping two refresh paths meant two places to get token storage wrong.
import { getValidGarminToken } from '../lib/garmin-token';

const API_BASE = (process.env.GARMIN_API_BASE || '').replace(/\/$/, '');

/** Build URL safely */
function buildUrl(path: string, query?: Record<string, string>): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(API_BASE + p);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * GET with a one-time 401/403 retry.
 *
 * getValidGarminToken already refreshes proactively when the stored token is
 * near expiry, so the retry only covers a token Garmin invalidated early.
 */
export async function apiGet<T>(
  userId: string,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  const token = await getValidGarminToken(userId);
  if (!token.ok) throw new Error(`No Garmin token for user: ${token.reason}`);

  const request = (bearer: string) =>
    fetch(buildUrl(path, query), {
      headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    });

  let res = await request(token.accessToken);

  if (res.status === 401 || res.status === 403) {
    const retryToken = await getValidGarminToken(userId);
    if (retryToken.ok && retryToken.accessToken !== token.accessToken) {
      res = await request(retryToken.accessToken);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Garmin API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export type GarminActivity = {
  id: string | number
  startTime?: string
  duration?: number
  distance?: number
  elevationGain?: number
}

export async function garminGetActivities(
  userId: string,
  params?: Record<string, string>
): Promise<GarminActivity[]> {
  // adjust path to the real endpoint when you have it
  return apiGet<GarminActivity[]>(userId, '/activities', params);
}
