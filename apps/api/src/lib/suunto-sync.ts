/**
 * Shared types + helpers for talking to Suunto's workout API. Used by
 * `routes/suunto.backfill.ts` (synchronous single-year import),
 * `workers/sync.worker.ts` (on-demand sync), and `workers/backfill.worker.ts`
 * (queued multi-year backfill).
 *
 * Keeping the API base, payload types, and header builder in one file prevents
 * drift between the three call sites.
 */

export const SUUNTO_API_BASE = 'https://cloudapi.suunto.com/v3';

// Shape of an individual workout as returned by GET /v3/workouts. Mirrors the
// webhook WORKOUT_CREATED payload — timestamps are epoch ms, distances meters,
// durations seconds.
export type SuuntoWorkout = {
  workoutKey: string;
  activityId: number;
  startTime: number;
  totalTime: number;
  totalDistance?: number;
  totalAscent?: number;
  totalDescent?: number;
  startPosition?: { x: number; y: number }; // x = longitude, y = latitude
  hrdata?: { workoutAvgHR?: number; workoutMaxHR?: number };
  timeOffsetInMinutes?: number;
};

// Suunto CloudAPI wraps list responses in { error, metadata, payload }.
export type SuuntoWorkoutsResponse = {
  error: unknown;
  metadata?: { totalCount?: number } & Record<string, unknown>;
  payload: SuuntoWorkout[];
};

// OAuth token-endpoint response shape used by both the initial code exchange
// (in `auth.suunto.ts`) and the refresh flow (in `suunto-token.ts`). Suunto's
// JWT `access_token` can be decoded for a `user` claim containing the Suunto
// username; see `extractSuuntoUsername` for the trust model.
export type SuuntoTokenResp = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

/**
 * Standard headers for every data-API call. The APIM gateway requires the
 * subscription key on top of the per-user bearer token; without it, requests
 * 401 before ever reaching the workout service.
 *
 * We throw instead of silently falling back — a missing env var would cause
 * every Suunto API call to fail with an opaque 401 from the APIM gateway,
 * which is much harder to diagnose than a clear startup-time error. Callers
 * are worker handlers and route handlers with normal error handling (BullMQ
 * retry + Sentry, or 500 response), so throwing here propagates cleanly.
 */
export function suuntoApiHeaders(accessToken: string): HeadersInit {
  const subscriptionKey = process.env.SUUNTO_SUBSCRIPTION_KEY;
  if (!subscriptionKey) {
    throw new Error('SUUNTO_SUBSCRIPTION_KEY is not set');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Ocp-Apim-Subscription-Key': subscriptionKey,
  };
}

import { acquireSuuntoApiCall } from './rate-limit';

/**
 * Thrown by `suuntoFetch` when the per-minute Suunto quota is exhausted.
 * Carries `retryAfterSec` so callers (workers, routes) can surface it to
 * the user or back off appropriately.
 */
export class SuuntoQuotaExceededError extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super(`Suunto API per-minute quota exhausted; retry after ${retryAfterSec}s`);
    this.name = 'SuuntoQuotaExceededError';
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Throttled fetch wrapper for Suunto's data API. Acquires a slot from the
 * app-wide minute/week quota (see `acquireSuuntoApiCall`) before issuing the
 * underlying `fetch`, throwing `SuuntoQuotaExceededError` if the per-minute
 * cap is hit so the caller can decide to fail the job or retry later.
 *
 * All callers of `cloudapi.suunto.com/v3/*` should use this wrapper instead
 * of `fetch + suuntoApiHeaders` directly so quota tracking stays accurate.
 */
export async function suuntoFetch(
  url: string,
  accessToken: string,
  init?: Omit<RequestInit, 'headers'>
): Promise<Response> {
  const slot = await acquireSuuntoApiCall();
  if (!slot.allowed) {
    throw new SuuntoQuotaExceededError(slot.retryAfter);
  }
  return fetch(url, {
    ...init,
    headers: suuntoApiHeaders(accessToken),
  });
}
