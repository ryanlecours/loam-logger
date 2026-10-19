import { parseClientHeader, resolveClient } from './clientPlatform';

describe('parseClientHeader', () => {
  it('parses platform and version', () => {
    expect(parseClientHeader('ios/1.4.0')).toEqual({ platform: 'ios', appVersion: '1.4.0' });
    expect(parseClientHeader('android/2.0.11')).toEqual({ platform: 'android', appVersion: '2.0.11' });
  });

  it('accepts a bare platform', () => {
    expect(parseClientHeader('web')).toEqual({ platform: 'web' });
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(parseClientHeader(' iOS/1.4.0 ')).toEqual({ platform: 'ios', appVersion: '1.4.0' });
  });

  it('rejects unknown platforms and free-form versions', () => {
    expect(parseClientHeader('windows/1.0.0')).toBeUndefined();
    expect(parseClientHeader('ios/1.4.0-beta')).toBeUndefined();
    expect(parseClientHeader('ios/latest')).toBeUndefined();
    expect(parseClientHeader('ios/1.4')).toBeUndefined();
  });

  it('rejects non-string values', () => {
    expect(parseClientHeader(undefined)).toBeUndefined();
    expect(parseClientHeader(['ios/1.4.0'])).toBeUndefined();
  });
});

describe('resolveClient', () => {
  it('prefers the header over the auth transport', () => {
    expect(resolveClient({ header: 'ios/1.4.0', authTransport: 'bearer', path: '/graphql' })).toEqual({
      platform: 'ios',
      appVersion: '1.4.0',
    });
  });

  it('falls back to cookie auth as web and bearer auth as mobile', () => {
    expect(resolveClient({ header: undefined, authTransport: 'cookie', path: '/graphql' })).toEqual({
      platform: 'web',
    });
    expect(resolveClient({ header: undefined, authTransport: 'bearer', path: '/graphql' })).toEqual({
      platform: 'mobile',
    });
  });

  it('ignores a malformed header and falls back to the auth transport', () => {
    expect(resolveClient({ header: 'nonsense', authTransport: 'bearer', path: '/graphql' })).toEqual({
      platform: 'mobile',
    });
  });

  it('treats the unauthenticated mobile auth routes as mobile', () => {
    expect(resolveClient({ header: undefined, path: '/auth/mobile/signup' })).toEqual({ platform: 'mobile' });
  });

  it('resolves nothing for requests no client made', () => {
    expect(resolveClient({ header: undefined, path: '/webhooks/strava' })).toBeUndefined();
    expect(resolveClient({ header: undefined, path: '/auth/strava/callback' })).toBeUndefined();
  });
});
