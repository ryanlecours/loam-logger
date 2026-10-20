import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeCbor, type CborValue } from './cbor';
import { readNonceExtension, verifyAppleAttestation, type VerifyAppleAttestationInput } from './apple-app-attest';

type Fixture = { attestation: string; keyId: string; challenge: string };
const loadFixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as Fixture;
const production = loadFixture('apple-attestation-production.json');
const development = loadFixture('apple-attestation-development.json');

// Real attestations recorded on devices by the node-app-attest project (see
// __fixtures__/README.md). Their App ID is the example app's, and their
// credential certificates were valid during 2024, so `now` is pinned there.
const TEAM_ID = 'V8H6LQ9448';
const BUNDLE_ID = 'io.uebelacker.AppAttestExample';
const IN_2024 = new Date('2024-06-01T00:00:00Z');

function input(fixture: { attestation: string; keyId: string; challenge: string }): VerifyAppleAttestationInput {
  return {
    attestation: fixture.attestation,
    keyId: fixture.keyId,
    clientData: Buffer.from(fixture.challenge, 'base64'),
    teamId: TEAM_ID,
    bundleId: BUNDLE_ID,
    now: IN_2024,
  };
}

/** Just enough CBOR encoding to rebuild a tampered attestation object. */
function encodeCbor(value: CborValue): Buffer {
  const head = (major: number, length: number): Buffer => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
    if (length < 0x10000) {
      const b = Buffer.alloc(3);
      b[0] = (major << 5) | 25;
      b.writeUInt16BE(length, 1);
      return b;
    }
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(length, 1);
    return b;
  };
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)])]);
  }
  throw new Error('unsupported in test encoder');
}

function tamper(mutate: (obj: { [key: string]: CborValue }) => void): string {
  const obj = decodeCbor(Buffer.from(production.attestation, 'base64')) as { [key: string]: CborValue };
  mutate(obj);
  return encodeCbor(obj).toString('base64');
}

describe('verifyAppleAttestation', () => {
  it('accepts a genuine production attestation', () => {
    expect(verifyAppleAttestation(input(production))).toEqual({ ok: true, environment: 'production' });
  });

  it('round-trips the fixture through the test encoder unchanged', () => {
    expect(tamper(() => undefined)).toBe(production.attestation);
  });

  it('rejects the development environment unless explicitly allowed', () => {
    expect(verifyAppleAttestation(input(development))).toEqual({ ok: false, reason: 'development_environment' });
    expect(verifyAppleAttestation({ ...input(development), allowDevelopment: true })).toEqual({
      ok: true,
      environment: 'development',
    });
  });

  it('rejects an attestation for a different challenge or email', () => {
    expect(verifyAppleAttestation({ ...input(production), clientData: Buffer.from('other.rider@example.com') })).toEqual({
      ok: false,
      reason: 'nonce_mismatch',
    });
  });

  it('rejects another app (team or bundle ID)', () => {
    expect(verifyAppleAttestation({ ...input(production), teamId: 'ABCDE12345' })).toEqual({
      ok: false,
      reason: 'app_id_mismatch',
    });
    expect(verifyAppleAttestation({ ...input(production), bundleId: 'com.loamlabs.loamlogger' })).toEqual({
      ok: false,
      reason: 'app_id_mismatch',
    });
  });

  it('rejects a key ID that is not the attested key', () => {
    const otherKey = createHash('sha256').update('another key').digest('base64');
    expect(verifyAppleAttestation({ ...input(production), keyId: otherKey })).toEqual({
      ok: false,
      reason: 'key_id_mismatch',
    });
  });

  it('rejects certificates outside their validity window', () => {
    expect(verifyAppleAttestation({ ...input(production), now: new Date('2026-10-20T00:00:00Z') })).toEqual({
      ok: false,
      reason: 'cert_expired',
    });
    expect(verifyAppleAttestation({ ...input(production), now: new Date('2023-01-01T00:00:00Z') })).toEqual({
      ok: false,
      reason: 'cert_expired',
    });
  });

  it('rejects a chain that does not lead to the Apple root', () => {
    const swapped = tamper((obj) => {
      const attStmt = obj.attStmt as { [key: string]: CborValue };
      attStmt.x5c = [...(attStmt.x5c as CborValue[])].reverse();
    });
    expect(verifyAppleAttestation({ ...input(production), attestation: swapped })).toEqual({
      ok: false,
      reason: 'bad_chain',
    });

    // A leaf from another attestation does not chain to this one's data either.
    const devLeaf = (
      (decodeCbor(Buffer.from(development.attestation, 'base64')) as { [key: string]: CborValue }).attStmt as {
        [key: string]: CborValue;
      }
    ).x5c as CborValue[];
    const mixed = tamper((obj) => {
      const attStmt = obj.attStmt as { [key: string]: CborValue };
      attStmt.x5c = [devLeaf[0], (attStmt.x5c as CborValue[])[1]];
    });
    expect(verifyAppleAttestation({ ...input(production), attestation: mixed })).toEqual({
      ok: false,
      reason: 'nonce_mismatch',
    });
  });

  it('rejects authenticator data that was altered after signing', () => {
    const altered = tamper((obj) => {
      const authData = Buffer.from(obj.authData as Buffer);
      authData.writeUInt32BE(1, 33); // counter
      obj.authData = authData;
    });
    // The nonce covers authData, so any edit breaks it before the counter check.
    expect(verifyAppleAttestation({ ...input(production), attestation: altered })).toEqual({
      ok: false,
      reason: 'nonce_mismatch',
    });
  });

  it.each([
    ['not base64 CBOR', 'bm90IGNib3I='],
    ['empty', ''],
    ['wrong format', tamper((obj) => void (obj.fmt = 'packed'))],
    ['one certificate', tamper((obj) => void ((obj.attStmt as { [key: string]: CborValue }).x5c = [Buffer.alloc(4)]))],
    ['missing authData', tamper((obj) => void delete obj.authData)],
  ])('reports %s as malformed', (_label, attestation) => {
    expect(verifyAppleAttestation({ ...input(production), attestation })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a key ID of the wrong length as malformed', () => {
    expect(verifyAppleAttestation({ ...input(production), keyId: 'c2hvcnQ=' })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('readNonceExtension', () => {
  it('extracts the 32-byte nonce from the credential certificate', () => {
    const obj = decodeCbor(Buffer.from(production.attestation, 'base64')) as { [key: string]: CborValue };
    const leaf = ((obj.attStmt as { [key: string]: CborValue }).x5c as Buffer[])[0];
    const expected = createHash('sha256')
      .update(obj.authData as Buffer)
      .update(createHash('sha256').update(Buffer.from(production.challenge, 'base64')).digest())
      .digest();
    expect(readNonceExtension(leaf)).toEqual(expected);
  });

  const certs = () =>
    ((decodeCbor(Buffer.from(production.attestation, 'base64')) as { [key: string]: CborValue }).attStmt as {
      [key: string]: CborValue;
    }).x5c as Buffer[];

  it('returns null for a certificate without the nonce extension', () => {
    expect(readNonceExtension(certs()[1])).toBeNull();
  });

  it.each([
    ['truncated', (leaf: Buffer) => leaf.subarray(0, 200)],
    ['cut inside a length', (leaf: Buffer) => leaf.subarray(0, 3)],
    ['a 4-byte length', () => Buffer.from([0x30, 0x84, 0x00, 0x00, 0x00, 0x10])],
    ['an indefinite length', () => Buffer.from([0x30, 0x80, 0x00, 0x00])],
    ['a high tag number', () => Buffer.from([0x1f, 0x81, 0x01, 0x00])],
    ['a child longer than its parent', () => Buffer.from([0x30, 0x03, 0x30, 0x05, 0x00])],
  ])('rejects DER that is %s', (_label, make) => {
    expect(() => readNonceExtension(make(certs()[0]))).toThrow();
  });

  it('maps unreadable certificate DER to malformed rather than throwing', () => {
    const broken = tamper((obj) => {
      const attStmt = obj.attStmt as { [key: string]: CborValue };
      attStmt.x5c = [(attStmt.x5c as Buffer[])[0].subarray(0, 200), (attStmt.x5c as Buffer[])[1]];
    });
    expect(verifyAppleAttestation({ ...input(production), attestation: broken })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});
