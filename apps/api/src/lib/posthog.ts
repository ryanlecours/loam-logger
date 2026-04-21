/**
 * Server-side PostHog client.
 *
 * Required env vars:
 *   POSTHOG_API_KEY   — Project API key from posthog.com, starts with `phc_`
 *   POSTHOG_HOST      — Optional; defaults to https://us.i.posthog.com
 *
 * When POSTHOG_API_KEY is unset (dev, tests, PR previews without the secret)
 * the client is a no-op — capture/flush calls return immediately.
 */

import * as Sentry from '@sentry/node';
import { LRUCache } from 'lru-cache';
import { PostHog } from 'posthog-node';
import { logger } from './logger';
import { prisma } from './prisma';

// Broad by design. `token` subsumes access_token / refresh_token / id_token /
// resetToken / sessionToken via substring match. `apiKey` and `api_key` are
// both listed because neither matches the other as a substring (camelCase vs
// snake_case). `auth` is deliberately omitted — it false-positives on words
// like "author" and "authentic". If you add a pattern, add a test in
// posthog.test.ts that proves it matches the expected key shapes.
const SENSITIVE_KEY_PATTERN = /password|token|secret|cookie|authorization|bearer|apiKey|api_key|jwt|credential/i;
const FILTERED = '[Filtered]';
const MAX_DEPTH = 8;

function scrubDeep(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1, seen));
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    out[k] = SENSITIVE_KEY_PATTERN.test(k)
      ? FILTERED
      : scrubDeep(obj[k], depth + 1, seen);
  }
  return out;
}

let client: PostHog | null = null;
let initialized = false;

function getClient(): PostHog | null {
  if (initialized) return client;
  initialized = true;

  // Defense-in-depth: never instantiate a real client under Jest, even if
  // POSTHOG_API_KEY leaked into the test env. Was root cause of ~272
  // spurious events/week previously attributed to the mock `user-123`
  // distinctId in onboarding.test.ts and friends.
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    logger?.info?.('PostHog disabled (test environment)');
    return null;
  }

  const key = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

  if (!key) {
    logger?.info?.('PostHog disabled (POSTHOG_API_KEY not set)');
    return null;
  }

  client = new PostHog(key, {
    host,
    // Short flush interval so events reach PostHog near-real-time. posthog-node
    // batches internally, so this is mostly a ceiling, not per-event latency.
    flushAt: 20,
    flushInterval: 10_000,
  });
  logger?.info?.({ host }, 'PostHog server client initialized');
  return client;
}

function scrub(properties: Record<string, unknown>): Record<string, unknown> {
  return scrubDeep(properties, 0, new WeakSet<object>()) as Record<string, unknown>;
}

// --- Per-user opt-out cache -------------------------------------------------
// We can't hit Prisma on every event without crushing the DB (workers fire
// these in hot loops). Short in-memory cache of the `analyticsOptOut` flag
// keyed on userId. On first event per user per TTL window we do one lookup;
// subsequent events hit the cache. Invalidated explicitly when the user
// toggles their opt-out via the mutation (invalidateOptOutCache).
//
// LRUCache instead of a plain Map so entries for churned users are bounded
// by `max` rather than accumulating indefinitely. 10k users is comfortably
// larger than active concurrent sessions for this app; spillover just means
// a re-lookup on next event, not a correctness issue.
const OPT_OUT_TTL_MS = 60_000;
const optOutCache = new LRUCache<string, { optOut: boolean; expiresAt: number }>({
  max: 10_000,
});

async function isOptedOut(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = optOutCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.optOut;
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { analyticsOptOut: true },
    });
    const optOut = Boolean(row?.analyticsOptOut);
    optOutCache.set(userId, { optOut, expiresAt: now + OPT_OUT_TTL_MS });
    return optOut;
  } catch (err) {
    // On DB failure, prefer a previously-cached opt-out `true` over the
    // fail-open default. Reasoning:
    //   - A user we've already seen as opted out continues to be honored
    //     while the DB is unavailable (GDPR Article 7(3): withdrawal of
    //     consent must stop processing even during outages).
    //   - A user we've already seen as opted in stays opted in (no behavior
    //     change; the cache value is also `false`).
    //   - A user we've never looked up gets the fail-open default (`false`).
    //     Blocking ALL events on a transient blip was rejected: it's worse
    //     ops-wise and doesn't protect anyone who isn't already opted out.
    //
    // We alert specifically for the never-cached case since that's where
    // the compliance risk actually lives.
    logger?.warn?.({ err, userId }, 'PostHog opt-out lookup failed');
    if (cached) return cached.optOut;
    try {
      Sentry.withScope((scope) => {
        scope.setTag('posthog.opt_out_lookup', 'failed');
        scope.setTag('compliance.risk', 'gdpr-art-7-3');
        scope.setContext('posthog', { userId });
        Sentry.captureException(err);
      });
    } catch {
      // Sentry not initialized in some environments — don't amplify failures
    }
    return false;
  }
}

/**
 * Invalidate the cached opt-out status for a user. Call from the resolver
 * that toggles `User.analyticsOptOut` so the next capture respects the new
 * value immediately instead of waiting for the TTL.
 */
export function invalidateOptOutCache(userId: string): void {
  optOutCache.delete(userId);
}

/**
 * Wipe the entire opt-out cache. Intended for test teardown — the cache is
 * module-level state that otherwise leaks across tests in the same process.
 * Exposed only via `__test` below; not a public export.
 */
function clearOptOutCache(): void {
  optOutCache.clear();
}

// Exported for unit tests. Not part of the public API — consumers should call
// captureServerEvent, which scrubs internally.
export const __test = {
  scrub,
  SENSITIVE_KEY_PATTERN,
  MAX_DEPTH,
  FILTERED,
  optOutCache,
  clearOptOutCache,
};

/**
 * Capture a server-authoritative event. distinctId MUST be the user's DB id
 * so events merge with the same user's client-side PostHog timeline.
 *
 * Fire-and-forget — callers do not await. The body is async internally to
 * await the opt-out lookup, but the outer call resolves immediately and any
 * errors are swallowed. Analytics failures must never break a request.
 */
export function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {}
): void {
  const c = getClient();
  if (!c) return;
  // Fire and forget. The opt-out lookup + capture run on a microtask; the
  // caller (resolver, webhook, worker) is never blocked on PostHog.
  void (async () => {
    try {
      if (await isOptedOut(distinctId)) return;
      c.capture({
        distinctId,
        event,
        properties: scrub(properties),
      });
    } catch (err) {
      logger?.warn?.({ err, event }, 'PostHog capture failed');
    }
  })();
}

/**
 * Flush pending events and shut down the client. Call from SIGTERM so in-flight
 * events aren't lost on deploy.
 *
 * Bounded at 2s to match Sentry's flush timeout in server.ts — a PostHog
 * outage during deploy shouldn't stall SIGTERM indefinitely.
 *
 * Routes through getClient() rather than reading the module-level `client`
 * directly so the lazy-init path runs here too. Prevents a no-op flush
 * when SIGTERM arrives before any captureServerEvent call has triggered
 * initialization (fast-shutdown tests, health-check-only deploys).
 */
export async function flushPostHog(): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.shutdown(2000);
  } catch (err) {
    logger?.warn?.({ err }, 'PostHog flush failed');
  }
}
