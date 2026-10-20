import * as Sentry from '@sentry/node';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { captureServerEvent } from '../lib/posthog';

/**
 * Cloudflare Turnstile on web password signup: the web counterpart of mobile
 * device attestation (services/device-attestation). The signup page renders
 * the widget and sends its token as `turnstileToken`; the API checks it with
 * siteverify before creating the account.
 *
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cloudflare documents tokens as at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 5000;

// Error codes that mean our own setup is wrong, not the visitor's token.
const SERVER_SIDE_ERROR_CODES = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

export type TurnstileCheck =
  | { ok: true; hostname?: string }
  /** `failed`: the token did not hold up. `error`: we could not check it. */
  | { ok: false; outcome: 'failed' | 'error'; reason: string };

export interface VerifyTurnstileTokenInput {
  token: string;
  secret: string;
  remoteIp?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface SiteverifyResponse {
  success?: unknown;
  'error-codes'?: unknown;
  hostname?: unknown;
}

/**
 * Ask Cloudflare whether a widget token is valid. Never throws: a network
 * failure or an unreadable answer comes back as `error`.
 */
export async function verifyTurnstileToken(input: VerifyTurnstileTokenInput): Promise<TurnstileCheck> {
  const { token, secret, remoteIp, fetchImpl = fetch, timeoutMs = SITEVERIFY_TIMEOUT_MS } = input;

  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);

  let res: Response;
  try {
    res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.warn({ err }, '[Turnstile] siteverify request failed');
    return { ok: false, outcome: 'error', reason: 'network' };
  }
  if (!res.ok) return { ok: false, outcome: 'error', reason: `http_${res.status}` };

  let body: SiteverifyResponse;
  try {
    body = (await res.json()) as SiteverifyResponse;
  } catch (err) {
    logger.warn({ err }, '[Turnstile] siteverify answered with something other than JSON');
    return { ok: false, outcome: 'error', reason: 'bad_response' };
  }

  if (body?.success === true) {
    return { ok: true, hostname: typeof body.hostname === 'string' ? body.hostname : undefined };
  }

  const codes = Array.isArray(body?.['error-codes'])
    ? body['error-codes'].filter((c): c is string => typeof c === 'string')
    : [];
  const serverSide = codes.find((c) => SERVER_SIDE_ERROR_CODES.has(c));
  if (serverSide) return { ok: false, outcome: 'error', reason: serverSide };
  return { ok: false, outcome: 'failed', reason: codes[0] ?? 'unknown' };
}

export type TurnstileOutcome =
  /** Cloudflare accepted the token. */
  | 'verified'
  /** A token was sent and Cloudflare rejected it (bad, expired or reused). */
  | 'failed'
  /** Our side could not check it (Cloudflare unreachable, not configured). */
  | 'error'
  /** No token at all: the widget did not load or had not finished, or a script. */
  | 'missing';

export interface TurnstileVerdict {
  outcome: TurnstileOutcome;
  reason?: string;
  /** Compact form stored on User.signupAttestation, e.g. `web:failed:timeout-or-duplicate`. */
  label: string;
  hostname?: string;
}

function verdict(outcome: TurnstileOutcome, reason?: string, hostname?: string): TurnstileVerdict {
  return { outcome, reason, label: ['web', outcome, reason].filter(Boolean).join(':'), hostname };
}

export interface EvaluateSignupTurnstileInput {
  token: unknown;
  remoteIp?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Judge a web signup's Turnstile token. Returns null when Turnstile is off.
 * Never throws: every problem becomes a verdict, so monitor mode cannot break
 * signup.
 */
export async function evaluateSignupTurnstile(input: EvaluateSignupTurnstileInput): Promise<TurnstileVerdict | null> {
  if (config.turnstileMode === 'off') return null;

  const { token } = input;
  if (token === undefined || token === null || token === '') return verdict('missing');
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return verdict('failed', 'malformed');
  if (!config.turnstileSecretKey) return verdict('error', 'not_configured');

  const result = await verifyTurnstileToken({
    token,
    secret: config.turnstileSecretKey,
    remoteIp: input.remoteIp,
    fetchImpl: input.fetchImpl,
  });
  if (result.ok) return verdict('verified', undefined, result.hostname);

  if (result.outcome === 'error') {
    logger.error({ reason: result.reason }, '[Turnstile] Could not verify a signup token');
    Sentry.captureMessage(`Turnstile siteverify unavailable: ${result.reason}`, {
      level: 'warning',
      tags: { route: 'signup', stage: 'turnstile' },
    });
  }
  return verdict(result.outcome, result.reason);
}

/**
 * Log configuration mistakes at startup instead of letting them surface as a
 * stream of `web:error:not_configured` verdicts.
 */
export function checkTurnstileConfig(rawMode: string | undefined = process.env.TURNSTILE_MODE): void {
  const mode = rawMode?.trim().toLowerCase();
  if (mode && mode !== 'off' && mode !== 'monitor' && mode !== 'enforce') {
    logger.warn({ value: rawMode }, '[Turnstile] Unrecognized TURNSTILE_MODE, using monitor');
  }
  if (config.turnstileMode === 'off') return;
  if (!config.turnstileSecretKey) {
    logger.warn('[Turnstile] TURNSTILE_SECRET_KEY not set; web signups record web:error:not_configured');
  }
  logger.info({ mode: config.turnstileMode }, '[Turnstile] Web signup check enabled');
}

/** True when enforce mode must send this signup through the unverified cap. */
export function requiresUnverifiedWebCap(result: TurnstileVerdict | null): boolean {
  if (config.turnstileMode !== 'enforce' || !result) return false;
  return result.outcome !== 'verified';
}

/**
 * Report a recorded verdict to PostHog once the account exists. Shares the
 * `signup_attestation` event with mobile, so one insight covers every
 * platform; `attestation_platform` is `web`.
 */
export function reportSignupTurnstile(userId: string, result: TurnstileVerdict): void {
  captureServerEvent(userId, 'signup_attestation', {
    attestation_mode: config.turnstileMode,
    attestation_outcome: result.outcome,
    attestation_platform: 'web',
    attestation_reason: result.reason ?? null,
    attestation_check: 'turnstile',
    turnstile_hostname: result.hostname ?? null,
  });
}
