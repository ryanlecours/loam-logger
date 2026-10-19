import { readFileSync } from 'fs';
import { join } from 'path';
import {
  evaluatePlayIntegrityPayload,
  MAX_TOKEN_AGE_MS,
  parseServiceAccountJson,
  type PlayIntegrityPayload,
} from './play-integrity';

const PACKAGE = 'com.loamlabs.loamlogger';
const REQUEST_HASH = 'a'.repeat(64);

function verdictFixture(): PlayIntegrityPayload & { requestDetails: NonNullable<PlayIntegrityPayload['requestDetails']> } {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', 'play-integrity-verdict.json'), 'utf8')
  ) as PlayIntegrityPayload & { requestDetails: NonNullable<PlayIntegrityPayload['requestDetails']> };
  fixture.requestDetails.requestHash = REQUEST_HASH;
  return fixture;
}

const ISSUED_AT = Number(verdictFixture().requestDetails.timestampMillis);
const NOW = new Date(ISSUED_AT + 60_000);

function evaluate(payload: unknown, now = NOW) {
  return evaluatePlayIntegrityPayload({ payload, packageName: PACKAGE, expectedRequestHash: REQUEST_HASH, now });
}

describe('evaluatePlayIntegrityPayload', () => {
  it('accepts a Play-recognized app on a device that meets device integrity', () => {
    expect(evaluate(verdictFixture())).toEqual({
      ok: true,
      details: {
        appRecognitionVerdict: 'PLAY_RECOGNIZED',
        deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
        appLicensingVerdict: 'LICENSED',
      },
    });
  });

  it('accepts stronger device verdicts alongside device integrity', () => {
    const payload = verdictFixture();
    payload.deviceIntegrity = {
      deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY'],
    };
    expect(evaluate(payload).ok).toBe(true);
  });

  it('rejects a token minted for another request (challenge or email)', () => {
    const payload = verdictFixture();
    payload.requestDetails.requestHash = 'b'.repeat(64);
    expect(evaluate(payload)).toMatchObject({ ok: false, reason: 'request_hash_mismatch' });
  });

  it('rejects a token requested by another package', () => {
    const payload = verdictFixture();
    payload.requestDetails.requestPackageName = 'com.example.cloned';
    expect(evaluate(payload)).toMatchObject({ ok: false, reason: 'package_mismatch' });
  });

  it('rejects an old token and one stamped far in the future', () => {
    expect(evaluate(verdictFixture(), new Date(ISSUED_AT + MAX_TOKEN_AGE_MS + 1))).toMatchObject({
      ok: false,
      reason: 'stale',
    });
    expect(evaluate(verdictFixture(), new Date(ISSUED_AT - 5 * 60_000))).toMatchObject({ ok: false, reason: 'stale' });
    const payload = verdictFixture();
    payload.requestDetails.timestampMillis = 'not a number';
    expect(evaluate(payload)).toMatchObject({ ok: false, reason: 'stale' });
  });

  it.each(['UNRECOGNIZED_VERSION', 'UNEVALUATED', undefined])(
    'rejects app recognition verdict %s (sideloaded or local build)',
    (appRecognitionVerdict) => {
      const payload = verdictFixture();
      payload.appIntegrity = { ...payload.appIntegrity, appRecognitionVerdict };
      expect(evaluate(payload)).toMatchObject({ ok: false, reason: 'app_not_recognized' });
    }
  );

  it('rejects an emulator or rooted device', () => {
    const basicOnly = verdictFixture();
    basicOnly.deviceIntegrity = { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] };
    expect(evaluate(basicOnly)).toEqual({
      ok: false,
      reason: 'device_integrity',
      details: expect.objectContaining({ deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] }),
    });

    // Google omits the field entirely when the device meets nothing.
    const none = verdictFixture();
    none.deviceIntegrity = {};
    expect(evaluate(none)).toMatchObject({ ok: false, reason: 'device_integrity' });
  });

  it.each([null, undefined, 'token', {}, { appIntegrity: {} }])('reports %p as malformed', (payload) => {
    expect(evaluate(payload)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('parseServiceAccountJson', () => {
  const key = { type: 'service_account', client_email: 'sa@project.iam.gserviceaccount.com', private_key: 'pem' };

  it('accepts raw JSON and base64 of it', () => {
    expect(parseServiceAccountJson(JSON.stringify(key))).toEqual(key);
    expect(parseServiceAccountJson(Buffer.from(JSON.stringify(key)).toString('base64'))).toEqual(key);
  });

  it('refuses a key without credentials', () => {
    expect(() => parseServiceAccountJson('{"type":"service_account"}')).toThrow(/client_email/);
  });
});
