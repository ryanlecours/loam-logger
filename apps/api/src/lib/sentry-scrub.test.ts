import { scrubKnownSecrets } from './sentry-scrub';

describe('scrubKnownSecrets', () => {
  it('replaces sensitive-keyed values in request.data with [Filtered]', () => {
    const event = {
      request: {
        data: { email: 'a@b.com', password: 'hunter2', newPassword: 'also-secret' },
      },
    };
    scrubKnownSecrets(event);
    expect(event.request.data).toEqual({
      email: 'a@b.com',
      password: '[Filtered]',
      newPassword: '[Filtered]',
    });
  });

  it('scrubs recursively through nested objects', () => {
    const event = {
      request: {
        data: {
          user: {
            profile: { name: 'Alex', token: 'should-be-gone' },
          },
        },
      },
    };
    scrubKnownSecrets(event);
    const nested = (event.request.data as { user: { profile: Record<string, unknown> } }).user.profile;
    expect(nested.name).toBe('Alex');
    expect(nested.token).toBe('[Filtered]');
  });

  it('scrubs values inside array elements', () => {
    const event = {
      extra: {
        items: [
          { id: 1, resetToken: 'r1' },
          { id: 2, resetToken: 'r2' },
        ],
      },
    };
    scrubKnownSecrets(event);
    expect((event.extra.items as Array<{ resetToken: string }>)[0].resetToken).toBe('[Filtered]');
    expect((event.extra.items as Array<{ resetToken: string }>)[1].resetToken).toBe('[Filtered]');
  });

  it('is case-insensitive on key names', () => {
    const event = {
      request: {
        data: { Password: 'x', AUTHORIZATION: 'Bearer y', Cookie: 'z' },
      },
    };
    scrubKnownSecrets(event);
    expect(event.request.data).toEqual({
      Password: '[Filtered]',
      AUTHORIZATION: '[Filtered]',
      Cookie: '[Filtered]',
    });
  });

  it('scrubs breadcrumb data entries', () => {
    const event = {
      breadcrumbs: [
        { message: 'login', data: { email: 'a@b.com', password: 'secret' } },
        { message: 'reset', data: { token: 'reset-token' } },
      ],
    };
    scrubKnownSecrets(event);
    expect(event.breadcrumbs[0].data?.password).toBe('[Filtered]');
    expect(event.breadcrumbs[1].data?.token).toBe('[Filtered]');
    // Non-sensitive keys untouched
    expect(event.breadcrumbs[0].data?.email).toBe('a@b.com');
  });

  it('does not touch unrelated keys', () => {
    const event = {
      request: {
        data: { id: 'user_1', name: 'Alex', location: 'here' },
      },
    };
    scrubKnownSecrets(event);
    expect(event.request.data).toEqual({ id: 'user_1', name: 'Alex', location: 'here' });
  });

  it('handles null/undefined/missing sections gracefully', () => {
    expect(() => scrubKnownSecrets({})).not.toThrow();
    expect(() => scrubKnownSecrets({ request: undefined })).not.toThrow();
    expect(() => scrubKnownSecrets({ extra: undefined })).not.toThrow();
  });

  it('does not loop forever on circular references', () => {
    const data: Record<string, unknown> = { name: 'loopy' };
    data.self = data;
    const event = { extra: { data } };
    expect(() => scrubKnownSecrets(event)).not.toThrow();
  });

  it('stops at a reasonable max depth to bound work', () => {
    // Build a deeply nested object; scrubber must not throw or hang.
    let deep: Record<string, unknown> = { password: 'leak' };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    const event = { extra: { deep } };
    expect(() => scrubKnownSecrets(event)).not.toThrow();
  });

  it('scrubs headers.authorization in request', () => {
    const event = {
      request: {
        headers: { Authorization: 'Bearer abc', 'User-Agent': 'test' },
      },
    };
    scrubKnownSecrets(event);
    expect(event.request.headers.Authorization).toBe('[Filtered]');
    expect(event.request.headers['User-Agent']).toBe('test');
  });

  it('returns the same event object (in-place mutation)', () => {
    const event = { request: { data: { password: 'x' } } };
    const result = scrubKnownSecrets(event);
    expect(result).toBe(event);
  });
});
