import { createHash, X509Certificate } from 'crypto';
import { decodeCbor, type CborValue } from './cbor';

/**
 * Verifies an Apple App Attest key attestation, following Apple's
 * "Validating apps that connect to your server" steps 1 to 9:
 * https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
 *
 * Built on Node's crypto instead of a package: node-app-attest is ESM-only
 * (it would need jest transform changes for it and its cbor dependency) and
 * does not check certificate validity dates. This version takes `now` so the
 * date check stays testable against recorded fixtures.
 */

/** Apple App Attestation Root CA, from https://www.apple.com/certificateauthority/private/ */
const APPLE_APP_ATTESTATION_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYwJAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNaFw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdhNbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9auYen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijVoyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

let rootCa: X509Certificate | null = null;
function getRootCa(): X509Certificate {
  rootCa ??= new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA_PEM);
  return rootCa;
}

/** OID 1.2.840.113635.100.8.2, the credential certificate's nonce extension. */
const NONCE_EXTENSION_OID = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

const AAGUID_PRODUCTION = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop');

export type AppleAttestationFailure =
  | 'malformed'
  | 'bad_chain'
  | 'cert_expired'
  | 'nonce_mismatch'
  | 'key_id_mismatch'
  | 'app_id_mismatch'
  | 'counter_nonzero'
  | 'development_environment'
  | 'bad_aaguid'
  | 'credential_id_mismatch';

export type AppleAttestationResult =
  | { ok: true; environment: 'production' | 'development' }
  | { ok: false; reason: AppleAttestationFailure };

export interface VerifyAppleAttestationInput {
  /** Base64 attestation object from attestKeyAsync. */
  attestation: string;
  /** Base64 key identifier from generateKeyAsync. */
  keyId: string;
  /** The exact bytes the app hashed as clientDataHash (the module hashes a UTF-8 string). */
  clientData: Buffer;
  teamId: string;
  bundleId: string;
  now?: Date;
  /** Accept the appattestdevelop environment. Never set in production code. */
  allowDevelopment?: boolean;
}

class AttestationError extends Error {
  constructor(readonly reason: AppleAttestationFailure) {
    super(reason);
  }
}

export function verifyAppleAttestation(input: VerifyAppleAttestationInput): AppleAttestationResult {
  try {
    return { ok: true, environment: verify(input) };
  } catch (err) {
    if (err instanceof AttestationError) return { ok: false, reason: err.reason };
    return { ok: false, reason: 'malformed' };
  }
}

function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function isMap(value: CborValue): value is { [key: string]: CborValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function verify(input: VerifyAppleAttestationInput): 'production' | 'development' {
  const now = input.now ?? new Date();
  const keyId = Buffer.from(input.keyId, 'base64');
  if (keyId.length !== 32) throw new AttestationError('malformed');

  const decoded = decodeCbor(Buffer.from(input.attestation, 'base64'));
  if (!isMap(decoded) || decoded.fmt !== 'apple-appattest') throw new AttestationError('malformed');
  const { attStmt, authData } = decoded;
  if (!isMap(attStmt) || !Buffer.isBuffer(authData) || !Array.isArray(attStmt.x5c) || attStmt.x5c.length !== 2) {
    throw new AttestationError('malformed');
  }
  const [leafDer, intermediateDer] = attStmt.x5c;
  if (!Buffer.isBuffer(leafDer) || !Buffer.isBuffer(intermediateDer)) throw new AttestationError('malformed');

  // 1. The credential certificate chains to Apple's App Attestation Root CA,
  //    and every certificate is inside its validity window.
  const leaf = new X509Certificate(leafDer);
  const intermediate = new X509Certificate(intermediateDer);
  const root = getRootCa();
  if (
    !intermediate.checkIssued(root) ||
    !intermediate.verify(root.publicKey) ||
    !leaf.checkIssued(intermediate) ||
    !leaf.verify(intermediate.publicKey)
  ) {
    throw new AttestationError('bad_chain');
  }
  for (const cert of [leaf, intermediate, root]) {
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      throw new AttestationError('cert_expired');
    }
  }

  // 2 to 4. nonce = SHA-256(authData || SHA-256(clientData)) must equal the
  //    octet string in the credential certificate's nonce extension.
  const expectedNonce = sha256(authData, sha256(input.clientData));
  const certNonce = readNonceExtension(leafDer);
  if (!certNonce || !certNonce.equals(expectedNonce)) throw new AttestationError('nonce_mismatch');

  // 5. keyId is the SHA-256 of the credential's public key (uncompressed EC point).
  const jwk = leaf.publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new AttestationError('malformed');
  const publicKeyPoint = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  if (!sha256(publicKeyPoint).equals(keyId)) throw new AttestationError('key_id_mismatch');

  // authData: rpIdHash(32) flags(1) signCount(4) aaguid(16) credIdLen(2) credId(n)
  if (authData.length < 55) throw new AttestationError('malformed');
  const credentialIdLength = authData.readUInt16BE(53);
  if (authData.length < 55 + credentialIdLength) throw new AttestationError('malformed');

  // 6. The RP ID hash is the SHA-256 of the App ID (team ID + bundle ID).
  const appIdHash = sha256(Buffer.from(`${input.teamId}.${input.bundleId}`));
  if (!authData.subarray(0, 32).equals(appIdHash)) throw new AttestationError('app_id_mismatch');

  // 7. A fresh attestation has a zero counter.
  if (authData.readUInt32BE(33) !== 0) throw new AttestationError('counter_nonzero');

  // 8. The aaguid names the App Attest environment.
  const aaguid = authData.subarray(37, 53);
  let environment: 'production' | 'development';
  if (aaguid.equals(AAGUID_PRODUCTION)) {
    environment = 'production';
  } else if (aaguid.equals(AAGUID_DEVELOPMENT)) {
    if (!input.allowDevelopment) throw new AttestationError('development_environment');
    environment = 'development';
  } else {
    throw new AttestationError('bad_aaguid');
  }

  // 9. The credential ID is the key identifier.
  if (!authData.subarray(55, 55 + credentialIdLength).equals(keyId)) {
    throw new AttestationError('credential_id_mismatch');
  }

  return environment;
}

// ---------------------------------------------------------------------------
// Just enough DER to pull one extension out of a certificate.

interface Tlv {
  tag: number;
  start: number;
  end: number;
}

function readTlv(buf: Buffer, offset: number): Tlv {
  if (offset + 2 > buf.length) throw new AttestationError('malformed');
  const tag = buf[offset];
  if ((tag & 0x1f) === 0x1f) throw new AttestationError('malformed');
  let length = buf[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 3 || start + bytes > buf.length) throw new AttestationError('malformed');
    length = 0;
    for (let i = 0; i < bytes; i++) length = (length << 8) | buf[start + i];
    start += bytes;
  }
  const end = start + length;
  if (end > buf.length) throw new AttestationError('malformed');
  return { tag, start, end };
}

function childrenOf(buf: Buffer, parent: Tlv): Tlv[] {
  const children: Tlv[] = [];
  let offset = parent.start;
  while (offset < parent.end) {
    const child = readTlv(buf, offset);
    if (child.end > parent.end) throw new AttestationError('malformed');
    children.push(child);
    offset = child.end;
  }
  return children;
}

const SEQUENCE = 0x30;
const OCTET_STRING = 0x04;
const OID = 0x06;
const EXTENSIONS = 0xa3; // [3] EXPLICIT in TBSCertificate

/** Returns the nonce from extension 1.2.840.113635.100.8.2, or null if absent. */
export function readNonceExtension(certDer: Buffer): Buffer | null {
  const cert = readTlv(certDer, 0);
  const [tbs] = childrenOf(certDer, cert);
  if (!tbs || tbs.tag !== SEQUENCE) throw new AttestationError('malformed');
  const extensionsWrapper = childrenOf(certDer, tbs).find((c) => c.tag === EXTENSIONS);
  if (!extensionsWrapper) return null;
  const [extensions] = childrenOf(certDer, extensionsWrapper);
  if (!extensions) return null;

  for (const extension of childrenOf(certDer, extensions)) {
    const parts = childrenOf(certDer, extension);
    const oid = parts[0];
    if (!oid || oid.tag !== OID || !certDer.subarray(oid.start, oid.end).equals(NONCE_EXTENSION_OID)) continue;
    const value = parts[parts.length - 1];
    if (value.tag !== OCTET_STRING) return null;
    // extnValue is SEQUENCE { [1] EXPLICIT OCTET STRING nonce }
    const sequence = readTlv(certDer, value.start);
    if (sequence.tag !== SEQUENCE) return null;
    for (const item of childrenOf(certDer, sequence)) {
      const constructed = (item.tag & 0x20) !== 0;
      const inner =
        item.tag === OCTET_STRING ? item : constructed ? childrenOf(certDer, item).find((c) => c.tag === OCTET_STRING) : undefined;
      if (inner) return Buffer.from(certDer.subarray(inner.start, inner.end));
    }
    return null;
  }
  return null;
}
