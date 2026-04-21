import { __test } from './posthog';

const { scrub, FILTERED } = __test;

describe('posthog scrub', () => {
  describe('flat properties', () => {
    it('passes through non-sensitive keys unchanged', () => {
      expect(scrub({ userId: 'u_123', count: 5, active: true })).toEqual({
        userId: 'u_123',
        count: 5,
        active: true,
      });
    });

    it('redacts password', () => {
      expect(scrub({ password: 'hunter2' })).toEqual({ password: FILTERED });
    });

    it('redacts newPassword / oldPassword (password as substring)', () => {
      expect(scrub({ newPassword: 'a', oldPassword: 'b' })).toEqual({
        newPassword: FILTERED,
        oldPassword: FILTERED,
      });
    });

    it('redacts token variants (access_token, refresh_token, id_token, resetToken)', () => {
      const result = scrub({
        access_token: 'a',
        refresh_token: 'b',
        id_token: 'c',
        resetToken: 'd',
        sessionToken: 'e',
        token: 'f',
      });
      expect(result).toEqual({
        access_token: FILTERED,
        refresh_token: FILTERED,
        id_token: FILTERED,
        resetToken: FILTERED,
        sessionToken: FILTERED,
        token: FILTERED,
      });
    });

    it('redacts apiKey / api_key', () => {
      expect(scrub({ apiKey: 'k', api_key: 'k' })).toEqual({
        apiKey: FILTERED,
        api_key: FILTERED,
      });
    });

    it('redacts authorization / bearer / cookie', () => {
      expect(
        scrub({ authorization: 'x', bearer: 'y', cookie: 'z' })
      ).toEqual({
        authorization: FILTERED,
        bearer: FILTERED,
        cookie: FILTERED,
      });
    });

    it('redacts jwt and credential', () => {
      expect(scrub({ jwt: 'x', credentials: { u: 'a', p: 'b' } })).toEqual({
        jwt: FILTERED,
        credentials: FILTERED,
      });
    });

    it('redacts secret', () => {
      expect(scrub({ clientSecret: 'x', secret: 'y' })).toEqual({
        clientSecret: FILTERED,
        secret: FILTERED,
      });
    });

    it('is case-insensitive', () => {
      expect(scrub({ PASSWORD: 'a', Token: 'b', APIKEY: 'c' })).toEqual({
        PASSWORD: FILTERED,
        Token: FILTERED,
        APIKEY: FILTERED,
      });
    });

    it('does NOT false-positive on author / authentic', () => {
      // "auth" is intentionally NOT in the pattern for this reason.
      const result = scrub({ author: 'Ryan', authentic: true });
      expect(result).toEqual({ author: 'Ryan', authentic: true });
    });
  });

  describe('nested properties', () => {
    it('redacts sensitive keys inside nested objects', () => {
      const input = {
        user: { id: 'u_1', password: 'hunter2' },
        stripe: { customerId: 'cus_1', apiKey: 'sk_123' },
      };
      expect(scrub(input)).toEqual({
        user: { id: 'u_1', password: FILTERED },
        stripe: { customerId: 'cus_1', apiKey: FILTERED },
      });
    });

    it('redacts sensitive keys inside arrays of objects', () => {
      const input = {
        events: [
          { name: 'login', token: 't1' },
          { name: 'logout', token: 't2' },
        ],
      };
      expect(scrub(input)).toEqual({
        events: [
          { name: 'login', token: FILTERED },
          { name: 'logout', token: FILTERED },
        ],
      });
    });

    it('handles deeply nested structures', () => {
      const input = {
        a: { b: { c: { d: { e: { password: 'deep' } } } } },
      };
      const result = scrub(input) as Record<string, unknown>;
      const e = (((((result.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<string, unknown>).d as Record<string, unknown>).e as Record<string, unknown>);
      expect(e.password).toBe(FILTERED);
    });
  });

  describe('safety', () => {
    it('handles null and undefined values', () => {
      expect(scrub({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
    });

    it('handles mixed primitive values', () => {
      expect(
        scrub({ str: 'x', num: 1, bool: true, arr: [1, 2], obj: { k: 'v' } })
      ).toEqual({ str: 'x', num: 1, bool: true, arr: [1, 2], obj: { k: 'v' } });
    });

    it('does not infinite-loop on circular references', () => {
      const a: Record<string, unknown> = { name: 'a' };
      const b: Record<string, unknown> = { name: 'b', ref: a };
      a.ref = b;
      // Should not throw or hang.
      expect(() => scrub({ root: a })).not.toThrow();
    });

    it('stops recursing past MAX_DEPTH without throwing', () => {
      let cur: Record<string, unknown> = { deepest: { password: 'x' } };
      for (let i = 0; i < 20; i++) {
        cur = { next: cur };
      }
      expect(() => scrub(cur)).not.toThrow();
    });

    it('redacts non-string values when key matches', () => {
      expect(scrub({ token: 12345, password: true, secret: null })).toEqual({
        token: FILTERED,
        password: FILTERED,
        secret: FILTERED,
      });
    });
  });
});
