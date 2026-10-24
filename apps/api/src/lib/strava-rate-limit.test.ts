const mockSet = jest.fn();
const mockGet = jest.fn();
const mockMget = jest.fn();
const mockExec = jest.fn();
const multiCalls: Array<[string, ...unknown[]]> = [];
let redisReady = true;

jest.mock('./redis', () => ({
  getRedisConnection: () => {
    const chain = {
      incr: (...a: unknown[]) => (multiCalls.push(['incr', ...a]), chain),
      expire: (...a: unknown[]) => (multiCalls.push(['expire', ...a]), chain),
      exec: mockExec,
    };
    return { set: mockSet, get: mockGet, mget: mockMget, multi: () => chain };
  },
  isRedisReady: () => redisReady,
}));

jest.mock('./logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  BULK_SHARE,
  checkStravaBudget,
  countStravaRead,
  getOwnStravaReads,
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
  mockMget.mockReset();
  mockExec.mockReset();
  multiCalls.length = 0;
  redisReady = true;
});

const NO_READS = { short: 0, daily: 0 };

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

  it.each([
    ['a bad date', { ...snapshot(), recordedAt: 'yesterday' }],
    ['a missing figure', { ...snapshot(), dailyUsage: undefined }],
    ['an unknown kind', { ...snapshot(), kind: 'write' }],
    ['not JSON', 'nope'],
  ])('treats a stored value with %s as unknown rather than as reset usage', async (_label, value) => {
    mockGet.mockResolvedValueOnce(typeof value === 'string' ? value : JSON.stringify(value));
    await expect(getStravaRateLimitSnapshot()).resolves.toBeNull();
  });
});

describe('countStravaRead / getOwnStravaReads', () => {
  it('counts a read against this quarter hour and today, each with an expiry', async () => {
    await countStravaRead(NOW);
    const q = Math.floor(NOW.getTime() / (15 * 60 * 1000));
    const d = Math.floor(NOW.getTime() / (24 * 60 * 60 * 1000));
    expect(multiCalls).toEqual([
      ['incr', `strava:reads:q:${q}`],
      ['expire', `strava:reads:q:${q}`, 1800],
      ['incr', `strava:reads:d:${d}`],
      ['expire', `strava:reads:d:${d}`, 172800],
    ]);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('never throws when counting', async () => {
    mockExec.mockRejectedValueOnce(new Error('READONLY'));
    await expect(countStravaRead(NOW)).resolves.toBeUndefined();
  });

  it('reads the current windows, treating missing keys as zero', async () => {
    mockMget.mockResolvedValueOnce(['12', null]);
    await expect(getOwnStravaReads(NOW)).resolves.toEqual({ short: 12, daily: 0 });
  });

  it('returns null when Redis cannot say', async () => {
    mockMget.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(getOwnStravaReads(NOW)).resolves.toBeNull();
    redisReady = false;
    await expect(getOwnStravaReads(NOW)).resolves.toBeNull();
  });
});

describe('checkStravaBudget', () => {
  it('allows a batch that fits in the bulk share of both windows', () => {
    const check = checkStravaBudget(snapshot(), NO_READS, 25, NOW);
    expect(check).toMatchObject({ allowed: true, shortUsed: 10, dailyUsed: 200, limitsFrom: 'strava-headers' });
    expect(BULK_SHARE).toBe(0.5);
  });

  it('uses Strava\'s standard read limits and our own count when no headers were seen', () => {
    // The 2026-10-24 production run: no snapshot ever recorded, 75 reads counted.
    const check = checkStravaBudget(null, { short: 75, daily: 75 }, 25, NOW);
    expect(check).toMatchObject({
      allowed: false,
      shortUsed: 75,
      shortLimit: 100,
      dailyLimit: 1000,
      limitsFrom: 'defaults',
    });
    expect(checkStravaBudget(null, NO_READS, 25, NOW)).toMatchObject({ allowed: true, limitsFrom: 'defaults' });
  });

  it('refuses when the read count is unknown', () => {
    const check = checkStravaBudget(snapshot(), null, 1, NOW);
    expect(check).toMatchObject({ allowed: false, retryAfter: 60 });
    expect(check.detail).toContain('unavailable');
  });

  it('uses the higher of the snapshot and our own count', () => {
    expect(checkStravaBudget(snapshot({ shortUsage: 5 }), { short: 40, daily: 40 }, 25, NOW)).toMatchObject({
      allowed: false,
      shortUsed: 40,
      dailyUsed: 200,
    });
  });

  it('refuses a batch that would pass half the 15-minute limit, until the next quarter hour', () => {
    const check = checkStravaBudget(snapshot({ shortUsage: 30 }), NO_READS, 25, NOW);
    expect(check.allowed).toBe(false);
    // 22:20 -> 22:30
    expect(check.retryAfter).toBe(600);
    expect(check.detail).toContain('30/100');
  });

  it('refuses a batch that would pass half the daily limit, until midnight UTC', () => {
    const check = checkStravaBudget(snapshot({ dailyUsage: 480 }), NO_READS, 25, NOW);
    expect(check.allowed).toBe(false);
    // 22:20 -> 24:00
    expect(check.retryAfter).toBe(100 * 60);
    expect(check.detail).toContain('today is 480/1000');
  });

  it('counts snapshot usage from an earlier window as reset', () => {
    const old = snapshot({ shortUsage: 99, dailyUsage: 999, recordedAt: '2026-10-23T23:59:00Z' });
    expect(checkStravaBudget(old, NO_READS, 25, NOW)).toMatchObject({ allowed: true, shortUsed: 0, dailyUsed: 0 });

    const earlier = snapshot({ shortUsage: 99, dailyUsage: 480, recordedAt: '2026-10-24T22:10:00Z' });
    expect(checkStravaBudget(earlier, NO_READS, 25, NOW)).toMatchObject({ allowed: false, shortUsed: 0, dailyUsed: 480 });
  });
});
