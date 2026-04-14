/**
 * Sentry event scrubbing helpers.
 *
 * The Pino logger in `./logger.ts` has its own redact list, but Sentry captures
 * request bodies, breadcrumb data, and context payloads that the logger never
 * touches. This module keeps the secret-stripping logic consistent across both.
 *
 * The shape used by Sentry events is loosely typed here to avoid coupling to
 * @sentry/types (which differs between @sentry/node and @sentry/react). Event
 * objects are plain JSON and we mutate them in place.
 */

/**
 * Keys whose values should be replaced with [Filtered] anywhere they appear
 * in a Sentry event. Matched case-insensitively on the key name, substring.
 * Deliberately broad — false positives here are safe (a scrubbed non-secret is
 * harmless), false negatives can leak credentials.
 */
const SENSITIVE_KEY_PATTERN = /password|token|secret|cookie|authorization|bearer|apiKey|api_key|resetToken|sessionToken/i;

const FILTERED = '[Filtered]';

// Prevent runaway recursion on circular refs or giant structures
const MAX_DEPTH = 8;

type Scrubable = Record<string, unknown> | unknown[] | null | undefined;

function scrubInPlace(value: Scrubable, depth: number, seen: WeakSet<object>): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') return;
  if (depth > MAX_DEPTH) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') {
        scrubInPlace(item as Scrubable, depth + 1, seen);
      }
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      obj[key] = FILTERED;
      continue;
    }
    const child = obj[key];
    if (child && typeof child === 'object') {
      scrubInPlace(child as Scrubable, depth + 1, seen);
    }
  }
}

/** Shape of the parts of a Sentry event we know how to scrub. */
export type ScrubbableSentryEvent = {
  request?: {
    data?: unknown;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    query_string?: unknown;
  };
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: unknown; message?: string }>;
  tags?: Record<string, unknown>;
};

/**
 * Walk a Sentry event in place, replacing values at any sensitive-named key
 * with [Filtered]. Returns the same event for convenience.
 */
export function scrubKnownSecrets<T extends ScrubbableSentryEvent>(event: T): T {
  const seen = new WeakSet<object>();
  if (event.request) scrubInPlace(event.request as Scrubable, 0, seen);
  if (event.contexts) scrubInPlace(event.contexts as Scrubable, 0, seen);
  if (event.extra) scrubInPlace(event.extra as Scrubable, 0, seen);
  if (event.breadcrumbs) {
    for (const bc of event.breadcrumbs) {
      if (bc.data) scrubInPlace(bc.data as Scrubable, 0, seen);
    }
  }
  return event;
}
