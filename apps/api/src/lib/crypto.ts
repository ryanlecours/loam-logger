import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Parse a 64-character hex string into a 32-byte AES-256 key.
 *
 * `name` is only used in the error message so a misconfigured rotation
 * (OLD vs NEW key) is told apart from a misconfigured server.
 */
export function parseEncryptionKey(
  hex: string | undefined,
  name = 'TOKEN_ENCRYPTION_KEY'
): Buffer {
  if (!hex || hex.length !== KEY_LENGTH * 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${name} must be set as a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}

function getKey(): Buffer {
  return parseEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY);
}

/**
 * Validate TOKEN_ENCRYPTION_KEY is present and correctly formatted.
 * Call at server startup to fail fast on misconfiguration.
 */
export function validateEncryptionKey(): void {
  getKey();
}

/**
 * Encrypt with an explicit key. Used by key rotation, which has to hold two
 * keys at once; application code should call `encrypt()` instead.
 * Returns a base64 string containing: iv (12 bytes) + authTag (16 bytes) + ciphertext.
 */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack as: iv + authTag + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt with an explicit key. Throws if the key is wrong or the data is
 * corrupt (GCM authentication fails). See `encryptWithKey`.
 */
export function decryptWithKey(encrypted: string, key: Buffer): string {
  const packed = Buffer.from(encrypted, 'base64');

  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Encrypt a plaintext string using AES-256-GCM and TOKEN_ENCRYPTION_KEY.
 * Returns a base64 string containing: iv (12 bytes) + authTag (16 bytes) + ciphertext.
 */
export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, getKey());
}

/**
 * Decrypt a base64 string produced by encrypt() using TOKEN_ENCRYPTION_KEY.
 */
export function decrypt(encrypted: string): string {
  return decryptWithKey(encrypted, getKey());
}
