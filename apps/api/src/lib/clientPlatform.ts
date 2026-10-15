/**
 * Which client (web app, iOS app, Android app) a request came from.
 *
 * Used to tag server-side analytics so API events can be split by platform.
 * Resolution order, most specific first:
 *
 *  1. The `x-loam-client` header the mobile app sends, e.g. `ios/1.4.0`.
 *     Carries the OS and the app's marketing version.
 *  2. The auth transport: the web app authenticates with the session cookie,
 *     the mobile app with a bearer token. Covers app builds that predate the
 *     header and the mobile app's raw fetch() calls that don't send it.
 *  3. The mobile-only auth routes (/auth/mobile/*), which run before any
 *     token exists.
 *
 * Anything else (webhooks, OAuth callbacks, workers) resolves to undefined:
 * those requests aren't made by a client, so callers that know the platform
 * (an OAuth callback knows whether it's the mobile flow) pass it explicitly.
 */

export type ClientPlatform = 'web' | 'ios' | 'android' | 'mobile';

export type AuthTransport = 'cookie' | 'bearer';

export interface ClientInfo {
  platform: ClientPlatform;
  appVersion?: string;
}

export const CLIENT_HEADER = 'x-loam-client';

// Strict on purpose: the value lands in analytics as a breakdown property, so
// anything free-form would let one client fill PostHog with junk values.
const CLIENT_HEADER_PATTERN = /^(ios|android|web)(?:\/(\d{1,4}\.\d{1,4}\.\d{1,4}))?$/;

export function parseClientHeader(value: unknown): ClientInfo | undefined {
  if (typeof value !== 'string') return undefined;
  const match = CLIENT_HEADER_PATTERN.exec(value.trim().toLowerCase());
  if (!match) return undefined;
  const [, platform, appVersion] = match;
  return appVersion
    ? { platform: platform as ClientPlatform, appVersion }
    : { platform: platform as ClientPlatform };
}

export function resolveClient(input: {
  header: unknown;
  authTransport?: AuthTransport;
  path: string;
}): ClientInfo | undefined {
  const fromHeader = parseClientHeader(input.header);
  if (fromHeader) return fromHeader;
  if (input.authTransport === 'cookie') return { platform: 'web' };
  if (input.authTransport === 'bearer') return { platform: 'mobile' };
  if (input.path.startsWith('/auth/mobile/')) return { platform: 'mobile' };
  return undefined;
}
