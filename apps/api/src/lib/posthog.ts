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

import { PostHog } from 'posthog-node';
import { logger } from './logger';

const SENSITIVE_KEY_PATTERN = /password|token|secret|cookie|authorization|bearer|apiKey|api_key|resetToken|sessionToken/i;
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

/**
 * Capture a server-authoritative event. distinctId MUST be the user's DB id
 * so events merge with the same user's client-side PostHog timeline.
 *
 * Swallows errors — analytics failures must never break a request.
 */
export function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {}
): void {
  const c = getClient();
  if (!c) return;
  try {
    c.capture({
      distinctId,
      event,
      properties: scrub(properties),
    });
  } catch (err) {
    logger?.warn?.({ err, event }, 'PostHog capture failed');
  }
}

/**
 * Flush pending events and shut down the client. Call from SIGTERM so in-flight
 * events aren't lost on deploy.
 *
 * Bounded at 2s to match Sentry's flush timeout in server.ts — a PostHog
 * outage during deploy shouldn't stall SIGTERM indefinitely.
 */
export async function flushPostHog(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown(2000);
  } catch (err) {
    logger?.warn?.({ err }, 'PostHog flush failed');
  }
}
