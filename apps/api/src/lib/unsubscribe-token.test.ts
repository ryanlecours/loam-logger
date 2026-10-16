// Set env before importing the module
const originalEnv = process.env;
process.env = { ...originalEnv, SESSION_SECRET: 'test-secret-key' };

import jwt from 'jsonwebtoken';
import { generateUnsubscribeToken, generateUnsubscribeUrl, verifyUnsubscribeToken } from './unsubscribe-token';

afterAll(() => {
  process.env = originalEnv;
});

describe('generateUnsubscribeToken', () => {
  it('round-trips the user id', () => {
    expect(verifyUnsubscribeToken(generateUnsubscribeToken('user123'))).toEqual({ userId: 'user123' });
  });

  it('expires after 90 days', () => {
    const decoded = jwt.decode(generateUnsubscribeToken('user123')) as { iat: number; exp: number; purpose: string };
    expect(decoded.purpose).toBe('unsubscribe');
    expect(decoded.exp - decoded.iat).toBe(90 * 24 * 60 * 60);
  });

  // While these were signed with SESSION_SECRET, the web session check took one
  // pasted into the ll_session cookie as a login.
  it('is not signed with SESSION_SECRET', () => {
    expect(() => jwt.verify(generateUnsubscribeToken('user123'), 'test-secret-key')).toThrow();
  });
});

describe('verifyUnsubscribeToken', () => {
  it('still accepts links already sent, signed with SESSION_SECRET', () => {
    const sent = jwt.sign({ uid: 'user123', purpose: 'unsubscribe' }, 'test-secret-key', { expiresIn: '90d' });
    expect(verifyUnsubscribeToken(sent)).toEqual({ userId: 'user123' });
  });

  it('returns null for an expired token', () => {
    const expired = jwt.sign({ uid: 'user123', purpose: 'unsubscribe' }, 'test-secret-key', { expiresIn: -10 });
    expect(verifyUnsubscribeToken(expired)).toBeNull();
  });

  it('returns null for a malformed or tampered token', () => {
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull();
    expect(verifyUnsubscribeToken(`${generateUnsubscribeToken('user123')}x`)).toBeNull();
  });

  it('returns null for a token signed with an unknown key', () => {
    const forged = jwt.sign({ uid: 'user123', purpose: 'unsubscribe' }, 'attacker-key');
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  // A session or mobile token is validly signed with SESSION_SECRET, so the
  // legacy fallback would verify it: the purpose check is what stops it.
  it('returns null for another SESSION_SECRET token, such as a session', () => {
    const session = jwt.sign({ uid: 'user123', v: 0, typ: 'web' }, 'test-secret-key', { expiresIn: '7d' });
    expect(verifyUnsubscribeToken(session)).toBeNull();
  });

  it('returns null when uid is missing or empty', () => {
    expect(verifyUnsubscribeToken(jwt.sign({ purpose: 'unsubscribe' }, 'test-secret-key'))).toBeNull();
    expect(verifyUnsubscribeToken(jwt.sign({ uid: '', purpose: 'unsubscribe' }, 'test-secret-key'))).toBeNull();
  });
});

describe('generateUnsubscribeUrl', () => {
  it('builds a link whose token verifies', () => {
    const url = new URL(generateUnsubscribeUrl('user123'));
    expect(url.pathname).toBe('/unsubscribe');
    expect(verifyUnsubscribeToken(url.searchParams.get('token')!)).toEqual({ userId: 'user123' });
  });
});
