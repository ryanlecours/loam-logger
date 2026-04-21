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

let client: PostHog | null = null;
const key = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

if (key) {
  client = new PostHog(key, {
    host,
    // Short flush interval so events reach PostHog near-real-time. posthog-node
    // batches internally, so this is mostly a ceiling, not per-event latency.
    flushAt: 20,
    flushInterval: 10_000,
  });
  logger.info({ host }, 'PostHog server client initialized');
} else {
  logger.info('PostHog disabled (POSTHOG_API_KEY not set)');
}

function scrub(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(properties)) {
    out[k] = SENSITIVE_KEY_PATTERN.test(k) ? FILTERED : properties[k];
  }
  return out;
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
  if (!client) return;
  try {
    client.capture({
      distinctId,
      event,
      properties: scrub(properties),
    });
  } catch (err) {
    logger.warn({ err, event }, 'PostHog capture failed');
  }
}

/**
 * Flush pending events and shut down the client. Call from SIGTERM so in-flight
 * events aren't lost on deploy.
 */
export async function flushPostHog(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch (err) {
    logger.warn({ err }, 'PostHog flush failed');
  }
}
