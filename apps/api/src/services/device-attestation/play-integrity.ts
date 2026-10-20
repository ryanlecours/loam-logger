import { GoogleAuth } from 'google-auth-library';

/**
 * Play Integrity standard requests. The app sends an opaque token; Google
 * decrypts and verifies it server to server (decodeIntegrityToken), and this
 * module judges the decoded verdict.
 *
 * Calls the REST endpoint through google-auth-library (already a dependency)
 * rather than pulling in the googleapis client.
 * https://developer.android.com/google/play/integrity/standard
 */

const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';

/** A standard token is minted right before signup, so anything older is a replay. */
export const MAX_TOKEN_AGE_MS = 10 * 60 * 1000;

/**
 * The decode runs inline in signup, so a slow Google answer delays the rider.
 * Past this it records `error:decode_failed` instead of waiting.
 */
export const DECODE_TIMEOUT_MS = 3000;

export type PlayIntegrityFailure =
  | 'malformed'
  | 'request_hash_mismatch'
  | 'package_mismatch'
  | 'stale'
  | 'app_not_recognized'
  | 'device_integrity';

export interface PlayIntegrityDetails {
  appRecognitionVerdict?: string;
  deviceRecognitionVerdict: string[];
  appLicensingVerdict?: string;
}

export type PlayIntegrityResult =
  | { ok: true; details: PlayIntegrityDetails }
  | { ok: false; reason: PlayIntegrityFailure; details?: PlayIntegrityDetails };

/** The decoded `tokenPayloadExternal`. Every field is optional on the wire. */
export interface PlayIntegrityPayload {
  requestDetails?: {
    requestPackageName?: string;
    requestHash?: string;
    timestampMillis?: string | number;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[];
  };
  accountDetails?: {
    appLicensingVerdict?: string;
  };
}

export interface EvaluatePlayIntegrityInput {
  payload: unknown;
  packageName: string;
  expectedRequestHash: string;
  now?: Date;
}

export function evaluatePlayIntegrityPayload(input: EvaluatePlayIntegrityInput): PlayIntegrityResult {
  const payload = input.payload as PlayIntegrityPayload | null | undefined;
  if (!payload || typeof payload !== 'object' || !payload.requestDetails) {
    return { ok: false, reason: 'malformed' };
  }
  const { requestDetails, appIntegrity, deviceIntegrity, accountDetails } = payload;
  const details: PlayIntegrityDetails = {
    appRecognitionVerdict: appIntegrity?.appRecognitionVerdict,
    deviceRecognitionVerdict: Array.isArray(deviceIntegrity?.deviceRecognitionVerdict)
      ? deviceIntegrity.deviceRecognitionVerdict
      : [],
    appLicensingVerdict: accountDetails?.appLicensingVerdict,
  };

  // Binding first: the token must be for this app and this exact request.
  if (requestDetails.requestHash !== input.expectedRequestHash) {
    return { ok: false, reason: 'request_hash_mismatch', details };
  }
  if (requestDetails.requestPackageName !== input.packageName) {
    return { ok: false, reason: 'package_mismatch', details };
  }

  const issuedAt = Number(requestDetails.timestampMillis);
  const now = (input.now ?? new Date()).getTime();
  // A little slack for clock skew on tokens stamped slightly in our future.
  if (!Number.isFinite(issuedAt) || now - issuedAt > MAX_TOKEN_AGE_MS || issuedAt - now > 60_000) {
    return { ok: false, reason: 'stale', details };
  }

  // PLAY_RECOGNIZED: the binary is the one Play distributes for this package.
  // Sideloaded and locally built apps answer UNRECOGNIZED_VERSION.
  if (appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED' || appIntegrity.packageName !== input.packageName) {
    return { ok: false, reason: 'app_not_recognized', details };
  }

  // MEETS_DEVICE_INTEGRITY: a genuine, Play-certified Android device. Emulators
  // and rooted or unlocked devices do not get it.
  if (!details.deviceRecognitionVerdict.includes('MEETS_DEVICE_INTEGRITY')) {
    return { ok: false, reason: 'device_integrity', details };
  }

  return { ok: true, details };
}

let auth: GoogleAuth | null = null;
let authCredentials: string | null = null;

/**
 * Parse the service account key, accepted either as raw JSON or base64 of it
 * (Railway variables keep either intact; base64 avoids newline escaping).
 */
export function parseServiceAccountJson(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('Play Integrity service account JSON is missing client_email or private_key');
  }
  return parsed;
}

function getAuth(serviceAccountJson: string): GoogleAuth {
  if (!auth || authCredentials !== serviceAccountJson) {
    auth = new GoogleAuth({
      credentials: parseServiceAccountJson(serviceAccountJson),
      scopes: [PLAY_INTEGRITY_SCOPE],
    });
    authCredentials = serviceAccountJson;
  }
  return auth;
}

/**
 * Exchange an integrity token for its verdict. Throws on any transport or
 * Google-side error; the caller records that as an `error` outcome.
 */
export async function decodeIntegrityToken(
  token: string,
  packageName: string,
  serviceAccountJson: string
): Promise<unknown> {
  const client = await getAuth(serviceAccountJson).getClient();
  const response = await client.request<{ tokenPayloadExternal?: unknown }>({
    url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
    method: 'POST',
    data: { integrityToken: token },
    timeout: DECODE_TIMEOUT_MS,
  });
  return response.data.tokenPayloadExternal;
}
