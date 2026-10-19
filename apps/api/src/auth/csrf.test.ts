import type { Response } from 'express';
import type { NextFunction, Request } from 'express';
import { isWellFormedCsrfToken, setCsrfCookie, verifyCsrf } from './csrf';

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

describe('verifyCsrf on the provider-link routes', () => {
  // The web link creates the session, so it can't carry a CSRF token yet;
  // it's exempt like /auth/login and protected by the link token + password.
  function run(path: string, cookies: Record<string, string>) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn() as NextFunction;
    verifyCsrf({ method: 'POST', path, headers: {}, cookies } as unknown as Request, res as unknown as Response, next);
    return { res, next };
  }

  it('lets the web link through even with a leftover session cookie and no CSRF header', () => {
    const { res, next } = run('/auth/link-provider', { ll_session: 'stale' });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lets the mobile link through, which carries no cookie, like /auth/mobile/google', () => {
    expect(run('/auth/mobile/link-provider', {}).next).toHaveBeenCalled();
  });

  it('still blocks a non-exempt path with a session cookie and no CSRF header', () => {
    const { res, next } = run('/auth/password/change', { ll_session: 'stale' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
