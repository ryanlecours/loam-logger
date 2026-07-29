jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { isTrustedGarminCallbackUrl, assertTrustedGarminCallbackUrl } from './garmin-callback-url';
import { logger } from './logger';

const originalApiBase = process.env.GARMIN_API_BASE;

afterEach(() => {
  jest.clearAllMocks();
  if (originalApiBase === undefined) {
    delete process.env.GARMIN_API_BASE;
  } else {
    process.env.GARMIN_API_BASE = originalApiBase;
  }
});

describe('isTrustedGarminCallbackUrl', () => {
  it('accepts Garmin production callback URLs', () => {
    expect(
      isTrustedGarminCallbackUrl(
        'https://apis.garmin.com/wellness-api/rest/activityDetails?uploadStartTimeInSeconds=1'
      )
    ).toBe(true);
  });

  /**
   * The threat this exists for: the activities-ping webhook has no signature
   * verification, so every field in the body is attacker-controlled, and
   * whatever URL lands here gets fetched with the rider's live Garmin bearer
   * token attached.
   */
  it('rejects an attacker-controlled origin', () => {
    expect(isTrustedGarminCallbackUrl('https://attacker.example/steal')).toBe(false);
  });

  // new URL() resolves these to the real host, which is exactly why the check
  // compares the parsed origin rather than doing string matching.
  it.each([
    ['credentials in the userinfo', 'https://apis.garmin.com@attacker.example/steal'],
    ['the allowed host in the path', 'https://attacker.example/apis.garmin.com/steal'],
    ['the allowed host in a query param', 'https://attacker.example/?x=apis.garmin.com'],
    ['the allowed host in the fragment', 'https://attacker.example/#apis.garmin.com'],
    ['a lookalike suffix', 'https://notapis.garmin.com.evil.example/steal'],
    ['a subdomain of the allowed host', 'https://evil.apis.garmin.com/steal'],
  ])('rejects %s', (_label, url) => {
    expect(isTrustedGarminCallbackUrl(url)).toBe(false);
  });

  // Origin comparison covers scheme and port, not just the hostname.
  it('rejects the right host on the wrong scheme or port', () => {
    expect(isTrustedGarminCallbackUrl('http://apis.garmin.com/wellness-api/rest/activities')).toBe(
      false
    );
    expect(isTrustedGarminCallbackUrl('https://apis.garmin.com:8443/wellness-api')).toBe(false);
  });

  it('rejects non-http schemes that could reach local resources', () => {
    expect(isTrustedGarminCallbackUrl('file:///etc/passwd')).toBe(false);
    expect(isTrustedGarminCallbackUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejects anything that is not a usable string', () => {
    expect(isTrustedGarminCallbackUrl(undefined)).toBe(false);
    expect(isTrustedGarminCallbackUrl(null)).toBe(false);
    expect(isTrustedGarminCallbackUrl('')).toBe(false);
    expect(isTrustedGarminCallbackUrl('not a url')).toBe(false);
    expect(isTrustedGarminCallbackUrl({ href: 'https://apis.garmin.com' })).toBe(false);
  });

  // A sandbox base has to keep working without widening the allowlist to
  // anything else.
  it('also accepts the configured API base origin', () => {
    process.env.GARMIN_API_BASE = 'https://apis-sandbox.garmin.com/wellness-api';

    expect(isTrustedGarminCallbackUrl('https://apis-sandbox.garmin.com/rest/activities')).toBe(true);
    // Production stays allowed, and nothing else is.
    expect(isTrustedGarminCallbackUrl('https://apis.garmin.com/rest/activities')).toBe(true);
    expect(isTrustedGarminCallbackUrl('https://attacker.example/steal')).toBe(false);
  });

  it('ignores a malformed API base rather than widening the allowlist', () => {
    process.env.GARMIN_API_BASE = 'not-a-url';

    expect(isTrustedGarminCallbackUrl('https://apis.garmin.com/rest/activities')).toBe(true);
    expect(isTrustedGarminCallbackUrl('https://attacker.example/steal')).toBe(false);
  });
});

describe('assertTrustedGarminCallbackUrl', () => {
  it('passes a trusted URL through without noise', () => {
    expect(assertTrustedGarminCallbackUrl('https://apis.garmin.com/rest/activities')).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  // A rejection is not a malformed Garmin payload, it is someone posting a
  // forged notification, so it needs to be alertable.
  it('logs an alertable error naming the target when it rejects', () => {
    expect(assertTrustedGarminCallbackUrl('https://attacker.example/steal', { userId: 'u1' })).toBe(
      false
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'garmin_untrusted_callback_url',
        userId: 'u1',
        callbackURL: 'https://attacker.example/steal',
      }),
      expect.stringContaining('Refusing to fetch')
    );
  });

  it('truncates the logged URL so it cannot flood the log', () => {
    const long = `https://attacker.example/${'a'.repeat(5000)}`;

    assertTrustedGarminCallbackUrl(long);

    const logged = (logger.error as jest.Mock).mock.calls[0][0] as { callbackURL: string };
    expect(logged.callbackURL.length).toBeLessThanOrEqual(200);
  });
});
