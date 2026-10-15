import jwt from 'jsonwebtoken';

const originalEnv = process.env;
process.env = { ...originalEnv, SESSION_SECRET: 'test-secret-key' };

import { generateAccountDeletionToken, verifyAccountDeletionToken } from './account-deletion-token';

afterAll(() => {
  process.env = originalEnv;
});

describe('account deletion token', () => {
  it('round-trips the user id and email', () => {
    const token = generateAccountDeletionToken('user_1', 'rider@example.com');
    expect(verifyAccountDeletionToken(token)).toEqual({
      ok: true,
      userId: 'user_1',
      email: 'rider@example.com',
    });
  });

  it('expires after an hour', () => {
    jest.useFakeTimers();
    try {
      const token = generateAccountDeletionToken('user_1', 'rider@example.com');
      jest.advanceTimersByTime(61 * 60 * 1000);
      expect(verifyAccountDeletionToken(token)).toEqual({ ok: false, reason: 'expired' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a tampered or garbage token', () => {
    const token = generateAccountDeletionToken('user_1', 'rider@example.com');
    expect(verifyAccountDeletionToken(`${token}x`)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyAccountDeletionToken('not-a-token')).toEqual({ ok: false, reason: 'invalid' });
  });

  // The web session check accepts any SESSION_SECRET-signed JWT with a uid, so
  // the two kinds must never verify under each other's key.
  it('is not signed with SESSION_SECRET, so it cannot pass as a session', () => {
    const token = generateAccountDeletionToken('user_1', 'rider@example.com');
    expect(() => jwt.verify(token, 'test-secret-key')).toThrow();
  });

  it('rejects SESSION_SECRET-signed tokens, even with the right claims', () => {
    const forged = jwt.sign(
      { uid: 'user_1', em: 'rider@example.com', purpose: 'account_deletion' },
      'test-secret-key',
      { expiresIn: '1h' },
    );
    expect(verifyAccountDeletionToken(forged)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('throws when SESSION_SECRET is not set', () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() => generateAccountDeletionToken('user_1', 'rider@example.com')).toThrow(
        'SESSION_SECRET environment variable is not set',
      );
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});
