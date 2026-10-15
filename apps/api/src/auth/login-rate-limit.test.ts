jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn(),
}));

import { checkAuthRateLimit } from '../lib/rate-limit';
import { checkLoginRateLimit, loginEmailKey } from './login-rate-limit';

const mockCheckAuthRateLimit = checkAuthRateLimit as jest.Mock;

describe('loginEmailKey', () => {
  it('is stable for the same email and never contains it', () => {
    const key = loginEmailKey('rider@example.com');
    expect(key).toBe(loginEmailKey('rider@example.com'));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('rider');
  });

  it('differs between emails', () => {
    expect(loginEmailKey('a@example.com')).not.toBe(loginEmailKey('b@example.com'));
  });
});

describe('checkLoginRateLimit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows when both the IP and the account are under their limits', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });

    const result = await checkLoginRateLimit('1.2.3.4', 'rider@example.com');

    expect(result.allowed).toBe(true);
    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('login', '1.2.3.4');
    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith(
      'login-email',
      loginEmailKey('rider@example.com')
    );
  });

  it('stops at the IP limit without charging the account', async () => {
    mockCheckAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 30, redisAvailable: true });

    const result = await checkLoginRateLimit('1.2.3.4', 'rider@example.com');

    expect(result).toEqual({ allowed: false, retryAfter: 30, redisAvailable: true });
    expect(mockCheckAuthRateLimit).toHaveBeenCalledTimes(1);
  });

  it('blocks when the account is over its limit even from a fresh IP', async () => {
    mockCheckAuthRateLimit
      .mockResolvedValueOnce({ allowed: true, redisAvailable: true })
      .mockResolvedValueOnce({ allowed: false, retryAfter: 600, redisAvailable: true });

    const result = await checkLoginRateLimit('5.6.7.8', 'rider@example.com');

    expect(result).toEqual({ allowed: false, retryAfter: 600, redisAvailable: true });
  });
});
