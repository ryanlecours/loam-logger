import { createHash } from 'crypto';
import * as Sentry from '@sentry/node';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { captureServerEvent } from '../../lib/posthog';
import { canonicalizeEmail } from '../../auth/utils';
import { consumeAttestationChallenge } from './challenge';
import { verifyAppleAttestation } from './apple-app-attest';
import { decodeIntegrityToken, evaluatePlayIntegrityPayload, type PlayIntegrityDetails } from './play-integrity';

export { issueAttestationChallenge, CHALLENGE_TTL_SECONDS } from './challenge';

/**
 * Device attestation for mobile password signup: proof that the request came
 * from the genuine Loam Logger app on a real device, not a script calling
 * POST /auth/mobile/signup.
 *
 * The app fetches a one-time challenge, then binds it to the signup email:
 *   clientData = UTF-8 of `${challenge}.${email}`
 * iOS passes that string to attestKeyAsync (which hashes it as App Attest's
 * clientDataHash). Android passes hex SHA-256 of it as the Play Integrity
 * requestHash. Binding the email means one attestation cannot be replayed for
 * a different address.
 */

export type AttestationPlatform = 'ios' | 'android';

export type AttestationOutcome =
  /** A valid attestation from the genuine app. */
  | 'verified'
  /** An attestation was sent and did not hold up. */
  | 'failed'
  /** Our side could not check it (Google unreachable, not configured). */
  | 'error'
  /** The app reported the device cannot attest (simulator, old device). */
  | 'unsupported'
  /** The app tried and the native attestation call threw. */
  | 'client_error'
  /** The signup email is on the DEVICE_ATTESTATION_BYPASS_EMAILS list. */
  | 'bypassed'
  /** No attestation at all, which is every app build before this shipped. */
  | 'missing';

export interface AttestationVerdict {
  outcome: AttestationOutcome;
  platform?: AttestationPlatform;
  reason?: string;
  /** Compact form stored on User.signupAttestation, e.g. `android:failed:device_integrity`. */
  label: string;
  details?: { environment?: string } & Partial<PlayIntegrityDetails>;
}

/** The optional `attestation` field of the mobile signup body. */
export interface SignupAttestationBody {
  platform?: unknown;
  challenge?: unknown;
  keyId?: unknown;
  attestation?: unknown;
  token?: unknown;
  unsupported?: unknown;
  clientError?: unknown;
}

// Real App Attest objects are about 5.5 KB of base64 and integrity tokens a
// few KB; anything far beyond that is not from the app.
const MAX_BLOB_LENGTH = 20_000;

export function attestationClientData(challenge: string, email: string): Buffer {
  return Buffer.from(`${challenge}.${email}`, 'utf8');
}

export function androidRequestHash(challenge: string, email: string): string {
  return createHash('sha256').update(attestationClientData(challenge, email)).digest('hex');
}

function verdict(
  outcome: AttestationOutcome,
  platform?: AttestationPlatform,
  reason?: string,
  details?: AttestationVerdict['details']
): AttestationVerdict {
  const label = platform ? [platform, outcome, reason].filter(Boolean).join(':') : outcome;
  return { outcome, platform, reason, label, details };
}

function isBypassed(email: string): boolean {
  const entries = config.deviceAttestationBypassEmails;
  if (entries.length === 0) return false;
  const canonical = canonicalizeEmail(email);
  const domain = email.slice(email.lastIndexOf('@')).toLowerCase();
  return entries.some((entry) => (entry.startsWith('@') ? entry === domain : canonicalizeEmail(entry) === canonical));
}

function isBlob(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_BLOB_LENGTH;
}

export interface EvaluateSignupAttestationInput {
  body: unknown;
  /** The email exactly as the app sent it; the app hashed this string. */
  rawEmail: string;
  /** The normalized email, for the bypass list. */
  email: string;
  now?: Date;
}

/**
 * Judge a signup's attestation. Returns null when attestation is off.
 * Never throws: every problem becomes a verdict, so monitor mode cannot break
 * signup.
 */
export async function evaluateSignupAttestation(input: EvaluateSignupAttestationInput): Promise<AttestationVerdict | null> {
  if (config.deviceAttestationMode === 'off') return null;

  const body = (input.body && typeof input.body === 'object' ? input.body : {}) as SignupAttestationBody;
  const platform: AttestationPlatform | undefined =
    body.platform === 'ios' || body.platform === 'android' ? body.platform : undefined;

  if (isBypassed(input.email)) return verdict('bypassed', platform);
  if (!platform) return verdict('missing');
  if (body.unsupported === true) return verdict('unsupported', platform);
  if (body.clientError === true) return verdict('client_error', platform);

  if (!(await consumeAttestationChallenge(body.challenge))) {
    return verdict('failed', platform, 'challenge_invalid');
  }
  const challenge = body.challenge as string;

  try {
    if (platform === 'ios') {
      if (!isBlob(body.attestation) || !isBlob(body.keyId)) return verdict('failed', platform, 'malformed');
      if (!config.appleTeamId || !config.appleBundleId) return verdict('error', platform, 'not_configured');
      const result = verifyAppleAttestation({
        attestation: body.attestation,
        keyId: body.keyId,
        clientData: attestationClientData(challenge, input.rawEmail),
        teamId: config.appleTeamId,
        bundleId: config.appleBundleId,
        now: input.now,
      });
      return result.ok
        ? verdict('verified', platform, undefined, { environment: result.environment })
        : verdict('failed', platform, result.reason);
    }

    if (!isBlob(body.token)) return verdict('failed', platform, 'malformed');
    if (!config.playIntegrityServiceAccountJson) return verdict('error', platform, 'not_configured');
    let payload: unknown;
    try {
      payload = await decodeIntegrityToken(body.token, config.androidPackageName, config.playIntegrityServiceAccountJson);
    } catch (err) {
      // Google rejects tokens it cannot decrypt with a 400; that is the
      // client's fault, not ours, and must not page anyone.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400) return verdict('failed', platform, 'token_rejected');
      logger.error({ err, status }, '[Attestation] Play Integrity decode failed');
      Sentry.captureException(err, { tags: { route: 'mobile/signup', stage: 'play-integrity-decode' } });
      return verdict('error', platform, 'decode_failed');
    }
    const result = evaluatePlayIntegrityPayload({
      payload,
      packageName: config.androidPackageName,
      expectedRequestHash: androidRequestHash(challenge, input.rawEmail),
      now: input.now,
    });
    return result.ok
      ? verdict('verified', platform, undefined, result.details)
      : verdict('failed', platform, result.reason, result.details);
  } catch (err) {
    logger.error({ err, platform }, '[Attestation] Verifier threw');
    Sentry.captureException(err, { tags: { route: 'mobile/signup', stage: 'attestation' } });
    return verdict('error', platform, 'internal');
  }
}

/** True when enforce mode must send this signup through the unattested cap. */
export function requiresUnattestedCap(result: AttestationVerdict | null): boolean {
  if (config.deviceAttestationMode !== 'enforce' || !result) return false;
  return result.outcome !== 'verified' && result.outcome !== 'bypassed';
}

/** Report a recorded verdict to PostHog once the account exists. */
export function reportSignupAttestation(userId: string, result: AttestationVerdict): void {
  captureServerEvent(userId, 'signup_attestation', {
    attestation_mode: config.deviceAttestationMode,
    attestation_outcome: result.outcome,
    attestation_platform: result.platform ?? null,
    attestation_reason: result.reason ?? null,
    attestation_environment: result.details?.environment ?? null,
    app_recognition_verdict: result.details?.appRecognitionVerdict ?? null,
    device_recognition_verdict: result.details?.deviceRecognitionVerdict?.join(',') ?? null,
  });
}
