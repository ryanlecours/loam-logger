import { createHash } from 'crypto';

const mockConfig = {
  deviceAttestationMode: 'monitor' as 'off' | 'monitor' | 'enforce',
  appleTeamId: 'ABCDE12345' as string | undefined,
  appleBundleId: 'com.loamlabs.loamlogger' as string | undefined,
  androidPackageName: 'com.loamlabs.loamlogger',
  playIntegrityServiceAccountJson: '{"client_email":"sa","private_key":"k"}' as string | undefined,
  deviceAttestationBypassEmails: [] as string[],
};
const mockConsume = jest.fn();
const mockVerifyApple = jest.fn();
const mockDecode = jest.fn();
const mockCapture = jest.fn();
const mockSentryCapture = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('../../config/env', () => ({ config: mockConfig }));
jest.mock('../../lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: (...a: unknown[]) => mockLoggerWarn(...a),
    info: (...a: unknown[]) => mockLoggerInfo(...a),
  },
}));
jest.mock('../../lib/posthog', () => ({ captureServerEvent: (...a: unknown[]) => mockCapture(...a) }));
jest.mock('@sentry/node', () => ({ captureException: (...a: unknown[]) => mockSentryCapture(...a) }));
jest.mock('./challenge', () => ({
  consumeAttestationChallenge: (...a: unknown[]) => mockConsume(...a),
  issueAttestationChallenge: jest.fn(),
  CHALLENGE_TTL_SECONDS: 300,
}));
jest.mock('./apple-app-attest', () => ({ verifyAppleAttestation: (...a: unknown[]) => mockVerifyApple(...a) }));
jest.mock('./play-integrity', () => ({
  ...jest.requireActual('./play-integrity'),
  decodeIntegrityToken: (...a: unknown[]) => mockDecode(...a),
}));

import {
  androidRequestHash,
  checkDeviceAttestationConfig,
  attestationClientData,
  evaluateSignupAttestation,
  reportSignupAttestation,
  requiresUnattestedCap,
  type AttestationVerdict,
} from './index';

const CHALLENGE = 'x'.repeat(43);
const RAW_EMAIL = 'Rider@Example.com';
const EMAIL = 'rider@example.com';
const NOW = new Date('2026-10-20T12:00:00Z');

function evaluate(body: unknown, email = EMAIL) {
  return evaluateSignupAttestation({ body, rawEmail: RAW_EMAIL, email, now: NOW });
}

function androidVerdict(overrides: Record<string, unknown> = {}) {
  return {
    requestDetails: {
      requestPackageName: 'com.loamlabs.loamlogger',
      requestHash: androidRequestHash(CHALLENGE, RAW_EMAIL),
      timestampMillis: String(NOW.getTime() - 5000),
    },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.loamlabs.loamlogger' },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.deviceAttestationMode = 'monitor';
  mockConfig.appleTeamId = 'ABCDE12345';
  mockConfig.playIntegrityServiceAccountJson = '{"client_email":"sa","private_key":"k"}';
  mockConfig.deviceAttestationBypassEmails = [];
  mockConsume.mockResolvedValue(true);
});

describe('client data binding', () => {
  it('joins the challenge and the email as sent, and hashes it in hex for Android', () => {
    expect(attestationClientData(CHALLENGE, RAW_EMAIL).toString('utf8')).toBe(`${CHALLENGE}.${RAW_EMAIL}`);
    expect(androidRequestHash(CHALLENGE, RAW_EMAIL)).toBe(
      createHash('sha256').update(`${CHALLENGE}.${RAW_EMAIL}`).digest('hex')
    );
  });
});

describe('evaluateSignupAttestation', () => {
  it('returns null when attestation is off', async () => {
    mockConfig.deviceAttestationMode = 'off';
    expect(await evaluate({ platform: 'ios' })).toBeNull();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('records missing for app builds that send nothing', async () => {
    expect(await evaluate(undefined)).toMatchObject({ outcome: 'missing', label: 'missing' });
    expect(await evaluate({ platform: 'windows' })).toMatchObject({ outcome: 'missing' });
  });

  it('records unsupported devices and client-side failures without spending a challenge', async () => {
    expect(await evaluate({ platform: 'ios', unsupported: true })).toMatchObject({ label: 'ios:unsupported' });
    expect(await evaluate({ platform: 'android', clientError: true })).toMatchObject({
      label: 'android:client_error',
    });
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('bypasses listed addresses on an exact match only', async () => {
    mockConfig.deviceAttestationBypassEmails = ['rider@example.com'];
    expect(await evaluate({ platform: 'android' }, 'rider@example.com')).toMatchObject({
      label: 'android:bypassed',
    });
    expect(mockLoggerInfo).toHaveBeenCalledWith({ platform: 'android' }, expect.stringContaining('bypassed'));

    // No alias folding: a +tag or dotted variant anyone can mint is not on the list.
    expect(await evaluate(undefined, 'rider+sim@example.com')).toMatchObject({ label: 'missing' });
    expect(await evaluate(undefined, 'ri.der@example.com')).toMatchObject({ label: 'missing' });
  });

  it('fails an unknown, expired or reused challenge', async () => {
    mockConsume.mockResolvedValue(false);
    expect(await evaluate({ platform: 'ios', challenge: CHALLENGE, keyId: 'k', attestation: 'a' })).toMatchObject({
      outcome: 'failed',
      label: 'ios:failed:challenge_invalid',
    });
    expect(mockVerifyApple).not.toHaveBeenCalled();
  });

  describe('iOS', () => {
    const body = { platform: 'ios', challenge: CHALLENGE, keyId: 'a2V5', attestation: 'YXR0' };

    it('verifies against the team and bundle ID with the bound client data', async () => {
      mockVerifyApple.mockReturnValue({ ok: true, environment: 'production' });

      expect(await evaluate(body)).toEqual({
        outcome: 'verified',
        platform: 'ios',
        reason: undefined,
        label: 'ios:verified',
        details: { environment: 'production' },
      });
      expect(mockConsume).toHaveBeenCalledWith(CHALLENGE);
      expect(mockVerifyApple).toHaveBeenCalledWith({
        attestation: 'YXR0',
        keyId: 'a2V5',
        clientData: Buffer.from(`${CHALLENGE}.${RAW_EMAIL}`),
        teamId: 'ABCDE12345',
        bundleId: 'com.loamlabs.loamlogger',
        now: NOW,
      });
    });

    it('records the verifier reason on failure', async () => {
      mockVerifyApple.mockReturnValue({ ok: false, reason: 'nonce_mismatch' });
      expect(await evaluate(body)).toMatchObject({ label: 'ios:failed:nonce_mismatch' });
    });

    it('fails a body without the attestation blobs', async () => {
      expect(await evaluate({ ...body, attestation: undefined })).toMatchObject({ label: 'ios:failed:malformed' });
      expect(await evaluate({ ...body, keyId: 'k'.repeat(20_001) })).toMatchObject({ label: 'ios:failed:malformed' });
    });

    it('reports a missing APPLE_TEAM_ID as our error, not the device failing', async () => {
      mockConfig.appleTeamId = undefined;
      expect(await evaluate(body)).toMatchObject({ outcome: 'error', label: 'ios:error:not_configured' });
    });
  });

  describe('Android', () => {
    const body = { platform: 'android', challenge: CHALLENGE, token: 'integrity-token' };

    it('decodes the token with Google and accepts a good verdict', async () => {
      mockDecode.mockResolvedValue(androidVerdict());

      expect(await evaluate(body)).toMatchObject({
        outcome: 'verified',
        label: 'android:verified',
        details: { appRecognitionVerdict: 'PLAY_RECOGNIZED', deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
      });
      expect(mockDecode).toHaveBeenCalledWith(
        'integrity-token',
        'com.loamlabs.loamlogger',
        '{"client_email":"sa","private_key":"k"}'
      );
    });

    it('fails a verdict bound to a different email', async () => {
      mockDecode.mockResolvedValue(androidVerdict());
      const result = await evaluateSignupAttestation({ body, rawEmail: 'other@example.com', email: 'other@example.com', now: NOW });
      expect(result).toMatchObject({ label: 'android:failed:request_hash_mismatch' });
    });

    it('fails an emulator verdict', async () => {
      mockDecode.mockResolvedValue(androidVerdict({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }));
      expect(await evaluate(body)).toMatchObject({ label: 'android:failed:device_integrity' });
    });

    it('treats a 400 from Google as a rejected token, quietly', async () => {
      mockDecode.mockRejectedValue(Object.assign(new Error('bad token'), { response: { status: 400 } }));
      expect(await evaluate(body)).toMatchObject({ label: 'android:failed:token_rejected' });
      expect(mockSentryCapture).not.toHaveBeenCalled();
    });

    it('treats a timeout or network error (no HTTP response) as our error, not a rejected token', async () => {
      mockDecode.mockRejectedValue(Object.assign(new Error('timeout of 3000ms exceeded'), { code: 'ECONNABORTED' }));
      expect(await evaluate(body)).toMatchObject({ outcome: 'error', label: 'android:error:decode_failed' });
      expect(mockSentryCapture).toHaveBeenCalledTimes(1);
    });

    it('reports other decode failures to Sentry as our error', async () => {
      mockDecode.mockRejectedValue(Object.assign(new Error('unavailable'), { response: { status: 503 } }));
      expect(await evaluate(body)).toMatchObject({ outcome: 'error', label: 'android:error:decode_failed' });
      expect(mockSentryCapture).toHaveBeenCalledTimes(1);
    });

    it('reports an unusable service account key to Sentry once, then quietly', async () => {
      mockConfig.playIntegrityServiceAccountJson = '{"type":"service_account"}';
      expect(await evaluate(body)).toMatchObject({ label: 'android:error:bad_service_account' });
      expect(await evaluate(body)).toMatchObject({ label: 'android:error:bad_service_account' });
      expect(mockSentryCapture).toHaveBeenCalledTimes(1);
      expect(mockDecode).not.toHaveBeenCalled();
    });

    it('reports a missing service account as our error', async () => {
      mockConfig.playIntegrityServiceAccountJson = undefined;
      expect(await evaluate(body)).toMatchObject({ label: 'android:error:not_configured' });
      expect(mockDecode).not.toHaveBeenCalled();
    });
  });
});

describe('checkDeviceAttestationConfig', () => {
  it('warns about an unrecognized mode instead of silently using monitor', () => {
    checkDeviceAttestationConfig('enforced');
    expect(mockLoggerWarn).toHaveBeenCalledWith({ value: 'enforced' }, expect.stringContaining('Unrecognized'));
  });

  it('warns about missing credentials and accepts a complete setup', () => {
    mockConfig.appleTeamId = undefined;
    mockConfig.playIntegrityServiceAccountJson = undefined;
    checkDeviceAttestationConfig('monitor');
    expect(mockLoggerWarn).toHaveBeenCalledTimes(2);

    jest.clearAllMocks();
    mockConfig.appleTeamId = 'ABCDE12345';
    mockConfig.playIntegrityServiceAccountJson = '{"client_email":"sa","private_key":"k"}';
    checkDeviceAttestationConfig('monitor');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'monitor', androidPackageName: 'com.loamlabs.loamlogger' }),
      expect.any(String)
    );
  });

  it('says nothing about credentials while attestation is off', () => {
    mockConfig.deviceAttestationMode = 'off';
    mockConfig.appleTeamId = undefined;
    checkDeviceAttestationConfig('off');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});

describe('requiresUnattestedCap', () => {
  const v = (outcome: AttestationVerdict['outcome']): AttestationVerdict => ({ outcome, label: outcome });

  it('never applies outside enforce mode', () => {
    expect(requiresUnattestedCap(v('missing'))).toBe(false);
    mockConfig.deviceAttestationMode = 'off';
    expect(requiresUnattestedCap(null)).toBe(false);
  });

  it('applies in enforce mode to everything but verified and bypassed', () => {
    mockConfig.deviceAttestationMode = 'enforce';
    expect(requiresUnattestedCap(v('verified'))).toBe(false);
    expect(requiresUnattestedCap(v('bypassed'))).toBe(false);
    for (const outcome of ['failed', 'error', 'unsupported', 'client_error', 'missing'] as const) {
      expect(requiresUnattestedCap(v(outcome))).toBe(true);
    }
  });
});

describe('reportSignupAttestation', () => {
  it('sends the verdict to PostHog under the new user', () => {
    reportSignupAttestation('u1', {
      outcome: 'failed',
      platform: 'android',
      reason: 'device_integrity',
      label: 'android:failed:device_integrity',
      details: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'], appRecognitionVerdict: 'PLAY_RECOGNIZED' },
    });
    expect(mockCapture).toHaveBeenCalledWith('u1', 'signup_attestation', {
      attestation_mode: 'monitor',
      attestation_outcome: 'failed',
      attestation_platform: 'android',
      attestation_reason: 'device_integrity',
      attestation_environment: null,
      app_recognition_verdict: 'PLAY_RECOGNIZED',
      device_recognition_verdict: 'MEETS_BASIC_INTEGRITY',
    });
  });
});
