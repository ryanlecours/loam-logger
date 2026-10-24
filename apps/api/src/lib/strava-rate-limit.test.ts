const mockSet = jest.fn();
const mockGet = jest.fn();
let redisReady = true;

jest.mock('./redis', () => ({
  getRedisConnection: () => ({ set: mockSet, get: mockGet }),
  isRedisReady: () => redisReady,
}));

jest.mock('./logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  BULK_SHARE,
  checkStravaBudget,
  getStravaRateLimitSnapshot,
  parseStravaRateLimit,
  recordStravaRateLimit,
  type StravaRateLimitSnapshot,
} from './strava-rate-limit';

const headers = (values: Record<string, string>) => new Headers(values);

const NOW = new Date('2026-10-24T22:20:00Z');

const snapshot = (over: Partial<StravaRateLimitSnapshot> = {}): StravaRateLimitSnapshot => ({
  kind: 'read',
  shortLimit: 100,
  shortUsage: 10,
  dailyLimit: 1000,
  dailyUsage: 200,
  recordedAt: '2026-10-24T22:16:00Z',
  ...over,
});

beforeEach(() => {
  mockSet.mockReset();
  mockGet.mockReset();
  redisReady = true;
});

describe('parseStravaRateLimit', () => {
  it('prefers the read limit, which is the tighter one for stream fetches', () => {
    const parsed = parseStravaRateLimit(
      headers({
        'X-RateLimit-Limit': '200,2000',
        'X-RateLimit-Usage': '30,400',
        'X-ReadRateLimit-Limit': '100,1000',
        'X-ReadRateLimit-Usage': '12,250',
      }),
      NOW
    );
    expect(parsed).toEqual({
      kind: 'read',
      shortLimit: 100,
      shortUsage: 12,
      dailyLimit: 1000,
      dailyUsage: 250,
      recordedAt: NOW.toISOString(),
    });
  });

  it('falls back to the overall limit when no read limit is sent', () => {
    const parsed = parseStravaRateLimit(
      headers({ 'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '30,400' }),
      NOW
    );
    expect(parsed?.kind).toBe('overall');
    expect(parsed?.shortLimit).toBe(200);
  });

  it.each([
    [{}],
    [{ 'X-ReadRateLimit-Limit': '100,1000' }],
    [{ 'X-ReadRateLimit-Limit': 'lots', 'X-ReadRateLimit-Usage': '1,2' }],
    [{ 'X-ReadRateLimit-Limit': '0,0', 'X-ReadRateLimit-Usage': '1,2' }],
  ])('returns null for headers it cannot read: %j', (values) => {
    expect(parseStravaRateLimit(headers(values), NOW)).toBeNull();
  });
});

describe('recordStravaRateLimit', () => {
  it('stores what Strava reported', async () => {
    await recordStravaRateLimit(
      headers({ 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '12,250' })
    );
    expect(mockSet).toHaveBeenCalledWith(
      'strava:ratelimit:latest',
      expect.stringContaining('"shortUsage":12'),
      'EX',
      86400
    );
  });

  it('never throws: missing headers, Redis down, or a failed write', async () => {
    await expect(recordStravaRateLimit(undefined)).resolves.toBeUndefined();
    redisReady = false;
    await expect(
      recordStravaRateLimit(headers({ 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '1,1' }))
    ).resolves.toBeUndefined();
    redisReady = true;
    mockSet.mockRejectedValueOnce(new Error('READONLY'));
    await expect(
      recordStravaRateLimit(headers({ 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '1,1' }))
    ).resolves.toBeUndefined();
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});

describe('getStravaRateLimitSnapshot', () => {
  it('returns null when nothing is recorded or Redis is down', async () => {
    mockGet.mockResolvedValueOnce(null);
    await expect(getStravaRateLimitSnapshot()).resolves.toBeNull();
    redisReady = false;
    await expect(getStravaRateLimitSnapshot()).resolves.toBeNull();
  });

  it('returns the stored snapshot', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify(snapshot()));
    await expect(getStravaRateLimitSnapshot()).resolves.toEqual(snapshot());
  });
});

describe('checkStravaBudget', () => {
  it('allows a batch that fits in the bulk share of both windows', () => {
    const check = checkStravaBudget(snapshot(), 25, NOW);
    expect(check).toMatchObject({ allowed: true, shortUsed: 10, dailyUsed: 200 });
    expect(BULK_SHARE).toBe(0.5);
  });

  it('allows one measuring batch when no usage has been recorded', () => {
    expect(checkStravaBudget(null, 25, NOW)).toMatchObject({ allowed: true, shortLimit: null });
  });

  it('refuses a batch that would pass half the 15-minute limit, until the next quarter hour', () => {
    const check = checkStravaBudget(snapshot({ shortUsage: 30 }), 25, NOW);
    expect(check.allowed).toBe(false);
    // 22:20 -> 22:30
    expect(check.retryAfter).toBe(600);
    expect(check.detail).toContain('30/100');
  });

  it('refuses a batch that would pass half the daily limit, until midnight UTC', () => {
    const check = checkStravaBudget(snapshot({ dailyUsage: 480 }), 25, NOW);
    expect(check.allowed).toBe(false);
    // 22:20 -> 24:00
    expect(check.retryAfter).toBe(100 * 60);
    expect(check.detail).toContain('today is 480/1000');
  });

  it('counts usage from an earlier window as reset', () => {
    // Recorded in the previous quarter hour and on the previous day.
    const old = snapshot({ shortUsage: 99, dailyUsage: 999, recordedAt: '2026-10-23T23:59:00Z' });
    expect(checkStravaBudget(old, 25, NOW)).toMatchObject({ allowed: true, shortUsed: 0, dailyUsed: 0 });

    // Same day, previous quarter hour: only the short window has reset.
    const earlier = snapshot({ shortUsage: 99, dailyUsage: 480, recordedAt: '2026-10-24T22:10:00Z' });
    expect(checkStravaBudget(earlier, 25, NOW)).toMatchObject({ allowed: false, shortUsed: 0, dailyUsed: 480 });
  });
});
