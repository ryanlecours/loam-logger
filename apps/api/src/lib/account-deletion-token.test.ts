import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const originalEnv = process.env;
process.env = { ...originalEnv, SESSION_SECRET: 'test-secret-key' };

import { generateAccountDeletionToken, verifyAccountDeletionToken } from './account-deletion-token';

afterAll(() => {
  process.env = originalEnv;
});

describe('account deletion token', () => {
  it('round-trips the user id and email', () => {
    const token = generateAccountDeletionToken('user_1', 'rider@example.com', 0);
    expect(verifyAccountDeletionToken(token)).toEqual({
      ok: true,
      userId: 'user_1',
      email: 'rider@example.com',
      sessionTokenVersion: 0,
    });
  });

  it('expires after an hour', () => {
    jest.useFakeTimers();
    try {
      const token = generateAccountDeletionToken('user_1', 'rider@example.com', 0);
      jest.advanceTimersByTime(61 * 60 * 1000);
      expect(verifyAccountDeletionToken(token)).toEqual({ ok: false, reason: 'expired' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a tampered or garbage token', () => {
    const token = generateAccountDeletionToken('user_1', 'rider@example.com', 0);
    expect(verifyAccountDeletionToken(`${token}x`)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyAccountDeletionToken('not-a-token')).toEqual({ ok: false, reason: 'invalid' });
  });

  // The web session check accepts any SESSION_SECRET-signed JWT with a uid, so
  // the two kinds must never verify under each other's key.
  it('is not signed with SESSION_SECRET, so it cannot pass as a session', () => {
    const token = generateAccountDeletionToken('user_1', 'rider@example.com', 0);
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

  it('rejects a token without a session version', () => {
    const key = crypto.createHmac('sha256', 'test-secret-key').update('loam:account-deletion:v1').digest('hex');
    const noVersion = jwt.sign({ uid: 'user_1', em: 'rider@example.com', purpose: 'account_deletion' }, key, { expiresIn: '1h' });
    expect(verifyAccountDeletionToken(noVersion)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('accepts only HS256', () => {
    const unsigned = jwt.sign(
      { uid: 'user_1', em: 'rider@example.com', v: 0, purpose: 'account_deletion' },
      '',
      { algorithm: 'none' },
    );
    expect(verifyAccountDeletionToken(unsigned)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('throws when SESSION_SECRET is not set', () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() => generateAccountDeletionToken('user_1', 'rider@example.com', 0)).toThrow(
        'SESSION_SECRET environment variable is not set',
      );
    } finally {
      process.env.SESSION_SECRET = saved;
    }
  });
});
