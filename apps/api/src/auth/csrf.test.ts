import type { Response } from 'express';
import { isWellFormedCsrfToken, setCsrfCookie } from './csrf';

describe('isWellFormedCsrfToken', () => {
  it('accepts the tokens setCsrfCookie mints', () => {
    const res = { cookie: jest.fn() } as unknown as Response;
    for (let i = 0; i < 5; i++) {
      expect(isWellFormedCsrfToken(setCsrfCookie(res))).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isWellFormedCsrfToken('a'.repeat(63))).toBe(false);
    expect(isWellFormedCsrfToken('a'.repeat(65))).toBe(false);
    expect(isWellFormedCsrfToken('A'.repeat(64))).toBe(false);
    expect(isWellFormedCsrfToken('<script>')).toBe(false);
    expect(isWellFormedCsrfToken(undefined)).toBe(false);
    expect(isWellFormedCsrfToken(['a'.repeat(64)])).toBe(false);
  });
});
