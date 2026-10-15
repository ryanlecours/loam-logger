import { createOriginAllowlist, parseExtraOrigins } from './cors-origin';

describe('createOriginAllowlist', () => {
  const allow = createOriginAllowlist({
    frontendUrl: 'https://loamlogger.app',
    extraOrigins: ['https://loam-logger-git-staging-ryan-lecours-projects.vercel.app'],
  });

  it('allows the web app, listed extras and local dev servers', () => {
    expect(allow('https://loamlogger.app')).toBe(true);
    expect(allow('https://loam-logger-git-staging-ryan-lecours-projects.vercel.app')).toBe(true);
    expect(allow('http://localhost:5173')).toBe(true);
    expect(allow('http://localhost:8081')).toBe(true);
    expect(allow('http://localhost:19000')).toBe(true);
    expect(allow('http://localhost:19006')).toBe(true);
  });

  it('allows requests with no Origin and the app schemes', () => {
    expect(allow(undefined)).toBe(true);
    expect(allow('exp://192.168.1.10:8081')).toBe(true);
    expect(allow('loamlogger://')).toBe(true);
  });

  it('refuses any vercel.app origin that is not listed', () => {
    expect(allow('https://evil.vercel.app')).toBe(false);
    // A name chosen to look like ours: anyone can claim <project>.vercel.app.
    expect(allow('https://loam-logger-x-ryan-lecours-projects.vercel.app')).toBe(false);
  });

  it('refuses near misses of allowed origins', () => {
    expect(allow('http://loamlogger.app')).toBe(false);
    expect(allow('https://loamlogger.app.evil.com')).toBe(false);
    expect(allow('https://evilloamlogger.app')).toBe(false);
    expect(allow('https://www.loamlogger.app')).toBe(false);
    expect(allow('http://localhost:3000')).toBe(false);
    expect(allow('null')).toBe(false);
  });

  it('matches a FRONTEND_URL given with a trailing slash', () => {
    const withSlash = createOriginAllowlist({ frontendUrl: 'https://loamlogger.app/', extraOrigins: [] });
    expect(withSlash('https://loamlogger.app')).toBe(true);
  });
});

describe('parseExtraOrigins', () => {
  it('splits, trims and drops empties and trailing slashes', () => {
    expect(parseExtraOrigins(' https://a.example , https://b.example/,, ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('returns nothing when unset', () => {
    expect(parseExtraOrigins(undefined)).toEqual([]);
    expect(parseExtraOrigins('')).toEqual([]);
  });
});
