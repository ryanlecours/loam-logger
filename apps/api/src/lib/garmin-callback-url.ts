import { logger } from './logger';

/**
 * Origin allowlist for Garmin callbackURLs.
 *
 * THREAT: the activities-ping webhook has no signature or HMAC verification.
 * The only gate is that the payload's `userId` matches a UserAccount row we
 * already hold, which is an identifier an attacker can guess or learn rather
 * than a secret. Every other field in that body is attacker-controlled,
 * including `callbackURL`.
 *
 * Any code that fetches one of those URLs attaches the rider's live Garmin
 * OAuth bearer token. Without this check, a forged ping carrying
 * `callbackURL: "https://attacker.example/steal"` makes the server hand that
 * rider's access token to the attacker, and the JSON they return is parsed and
 * upserted into that rider's ride history. SSRF, credential exfiltration and
 * data injection from one unauthenticated POST.
 *
 * Matching is on the full ORIGIN, not the hostname, so protocol and port have
 * to agree too. `new URL()` resolves embedded credentials and other host
 * confusion (`https://apis.garmin.com@evil.example/`) to the real host, so
 * comparing its `origin` is not fooled by them.
 *
 * The configured API base is allowed alongside the production origin so a
 * sandbox or local GARMIN_API_BASE keeps working without punching a hole for
 * anything else.
 */

const GARMIN_PRODUCTION_ORIGIN = 'https://apis.garmin.com';

function allowedOrigins(): string[] {
  const origins = new Set<string>([GARMIN_PRODUCTION_ORIGIN]);

  const configured = process.env.GARMIN_API_BASE;
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // A malformed GARMIN_API_BASE is a deployment problem, not a reason to
      // widen the allowlist. Fall through with the production origin only.
      logger.warn(
        { configured },
        '[GarminCallbackUrl] GARMIN_API_BASE is not a valid URL; ignoring it for the allowlist'
      );
    }
  }

  return [...origins];
}

/** Is this a URL we are willing to send a rider's Garmin token to? */
export function isTrustedGarminCallbackUrl(callbackURL: unknown): callbackURL is string {
  if (typeof callbackURL !== 'string' || callbackURL.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(callbackURL);
  } catch {
    return false;
  }

  return allowedOrigins().includes(parsed.origin);
}

/**
 * Reject an untrusted callbackURL loudly.
 *
 * Emits a distinct, alertable event: a rejection here is not a bug in Garmin's
 * payload, it is someone posting a forged notification at the webhook. The URL
 * is logged so the target is visible, truncated so a huge string cannot be used
 * to flood the log.
 *
 * @returns true when the URL is safe to fetch.
 */
export function assertTrustedGarminCallbackUrl(
  callbackURL: unknown,
  context: Record<string, unknown> = {}
): callbackURL is string {
  if (isTrustedGarminCallbackUrl(callbackURL)) return true;

  logger.error(
    {
      event: 'garmin_untrusted_callback_url',
      ...context,
      callbackURL: typeof callbackURL === 'string' ? callbackURL.slice(0, 200) : typeof callbackURL,
    },
    '[GarminCallbackUrl] Refusing to fetch a callbackURL outside Garmin; possible forged notification'
  );

  return false;
}
