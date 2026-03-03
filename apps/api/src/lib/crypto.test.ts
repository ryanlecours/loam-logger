import crypto from 'crypto';

// Set a valid key before importing the module under test
const TEST_KEY = crypto.randomBytes(32).toString('hex');
process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;

import { encrypt, decrypt, validateEncryptionKey } from './crypto';

describe('crypto', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  describe('encrypt / decrypt round-trip', () => {
    it('should round-trip a simple string', () => {
      const plaintext = 'hello world';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should round-trip an empty string', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('should round-trip unicode and special characters', () => {
      const plaintext = '🔐 tökèn/sécrêt+value=abc&foo=bar';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should round-trip a long string', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('should produce different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'same input';
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);
      expect(a).not.toBe(b);
      // Both should decrypt to the same value
      expect(decrypt(a)).toBe(plaintext);
      expect(decrypt(b)).toBe(plaintext);
    });
  });

  describe('decrypt error handling', () => {
    it('should throw on tampered auth tag', () => {
      const encrypted = encrypt('secret');
      const packed = Buffer.from(encrypted, 'base64');

      // Flip a byte in the auth tag region (bytes 12-27)
      packed[15] ^= 0xff;
      const tampered = packed.toString('base64');

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      const packed = Buffer.from(encrypted, 'base64');

      // Flip a byte in the ciphertext region (after byte 28)
      if (packed.length > 28) {
        packed[28] ^= 0xff;
      }
      const tampered = packed.toString('base64');

      expect(() => decrypt(tampered)).toThrow();
    });

    it('should throw on input shorter than IV + auth tag', () => {
      const tooShort = Buffer.alloc(20).toString('base64'); // 20 < 12 + 16
      expect(() => decrypt(tooShort)).toThrow('Invalid encrypted data: too short');
    });

    it('should throw on empty input', () => {
      expect(() => decrypt('')).toThrow('Invalid encrypted data: too short');
    });
  });

  describe('validateEncryptionKey', () => {
    it('should not throw with a valid key', () => {
      expect(() => validateEncryptionKey()).not.toThrow();
    });

    it('should throw when key is missing', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(() => validateEncryptionKey()).toThrow(
        'TOKEN_ENCRYPTION_KEY must be set as a 64-character hex string (32 bytes)'
      );
    });

    it('should throw when key is too short', () => {
      process.env.TOKEN_ENCRYPTION_KEY = 'abcd';
      expect(() => validateEncryptionKey()).toThrow(
        'TOKEN_ENCRYPTION_KEY must be set as a 64-character hex string (32 bytes)'
      );
    });

    it('should throw when key is too long', () => {
      process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(128);
      expect(() => validateEncryptionKey()).toThrow(
        'TOKEN_ENCRYPTION_KEY must be set as a 64-character hex string (32 bytes)'
      );
    });
  });

  describe('wrong key', () => {
    it('should fail to decrypt with a different key', () => {
      const encrypted = encrypt('secret');

      // Switch to a different key
      process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

      expect(() => decrypt(encrypted)).toThrow();
    });
  });
});
