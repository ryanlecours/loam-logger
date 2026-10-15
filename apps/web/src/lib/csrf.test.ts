import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCsrfToken, refreshCsrfToken } from './csrf';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('refreshCsrfToken', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('caches the token the API returns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { csrfToken: 'fresh' })));

    await expect(refreshCsrfToken()).resolves.toBe('fresh');
    expect(getCsrfToken()).toBe('fresh');
  });

  it('builds the URL without a doubled slash', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/');
    const fetch = vi.fn(async () => json(200, { csrfToken: 'fresh' }));
    vi.stubGlobal('fetch', fetch);

    await refreshCsrfToken();

    expect(fetch).toHaveBeenCalledWith('https://api.example.test/auth/csrf-token', { credentials: 'include' });
  });

  it('resolves undefined on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(refreshCsrfToken()).resolves.toBeUndefined();
    expect(getCsrfToken()).toBeUndefined();
  });

  it('resolves undefined when a 200 carries no token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, {})));

    await expect(refreshCsrfToken()).resolves.toBeUndefined();
    expect(getCsrfToken()).toBeUndefined();
  });

  it('shares one request while in flight, then fetches again once settled', async () => {
    const fetch = vi.fn(async () => json(200, { csrfToken: 'fresh' }));
    vi.stubGlobal('fetch', fetch);

    await Promise.all([refreshCsrfToken(), refreshCsrfToken()]);
    expect(fetch).toHaveBeenCalledTimes(1);

    await refreshCsrfToken();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
