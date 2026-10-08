import * as Sentry from '@sentry/node';
import { config } from '../config/env';
import { logger } from './logger';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

export type TurnstileResult =
  | { ok: true; skipped?: 'not_configured' | 'unavailable' }
  | { ok: false; errorCodes: string[] };

if (!config.turnstileSecretKey && config.isProduction) {
  logger.warn('[Turnstile] TURNSTILE_SECRET_KEY not set: web signup runs without a bot challenge');
}

/**
 * Check a Cloudflare Turnstile token from the web signup form.
 *
 * Skipped when TURNSTILE_SECRET_KEY is unset, so local dev needs no keys and
 * the secret can be added only once the web build that sends tokens is live.
 *
 * A missing or rejected token fails the check. Cloudflare being unreachable
 * does not: an outage there should not stop real riders signing up, and a bot
 * cannot cause one. The signup rate limits still apply either way.
 *
 * Any non-2xx answer counts as unreachable too, 4xx included. Siteverify
 * reports a bad token, and a bad secret, as 200 with success false, so those
 * still fail closed. A 4xx means the request itself was malformed, which is
 * our bug, and failing closed on it would refuse every web signup. The
 * accepted cost: if something made siteverify return errors for our server,
 * signups would pass unchallenged, bounded by the per-IP minute and daily
 * limits, until the Sentry warning below is noticed.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string
): Promise<TurnstileResult> {
  const secret = config.turnstileSecretKey;
  if (!secret) return { ok: true, skipped: 'not_configured' };
  if (!token) return { ok: false, errorCodes: ['missing-input-response'] };

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`siteverify returned HTTP ${res.status}`);

    const body = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (body.success) return { ok: true };
    return { ok: false, errorCodes: body['error-codes'] ?? [] };
  } catch (err) {
    logger.warn({ err }, '[Turnstile] siteverify unavailable, allowing signup');
    Sentry.captureException(err, { level: 'warning', tags: { stage: 'turnstile-siteverify' } });
    return { ok: true, skipped: 'unavailable' };
  }
}
