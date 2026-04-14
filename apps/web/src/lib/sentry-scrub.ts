/**
 * Strip secret-looking keys from Sentry events before they leave the browser.
 *
 * Session Replay masks DOM input, but a GraphQL error whose variables include
 * `{ password: ... }` or a thrown error whose breadcrumb carries a reset token
 * would still land in Sentry unredacted. This walks the event in place.
 *
 * Kept independent of the API-side copy ([apps/api/src/lib/sentry-scrub.ts])
 * so the browser bundle stays free of Node-only deps. Pattern must stay in
 * sync with the server version.
 */

const SENSITIVE_KEY_PATTERN = /password|token|secret|cookie|authorization|bearer|apiKey|api_key|resetToken|sessionToken/i;

const FILTERED = '[Filtered]';
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
