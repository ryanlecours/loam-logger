// Mock redis before importing
jest.mock('./redis', () => ({
  isRedisReady: jest.fn(),
  getRedisConnection: jest.fn(),
}));

// The auth limiter raises abuse reports through Sentry; spy on them rather
// than shipping events from the test run.
jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

import {
  RATE_LIMITS,
  ADMIN_RATE_LIMITS,
  LOCK_TTL,
  SUUNTO_QUOTA,
  checkRateLimit,
  checkAdminRateLimit,
  clearRateLimit,
  acquireLock,
  releaseLock,
  extendLock,
  acquireSuuntoApiCall,
  getSuuntoWeekCount,
  checkMutationRateLimit,
  checkQueryRateLimit,
  checkAuthRateLimit,
  MUTATION_RATE_LIMITS,
  AUTH_RATE_LIMITS,
} from './rate-limit';
import { isRedisReady, getRedisConnection } from './redis';
import * as Sentry from '@sentry/node';

const mockIsRedisReady = isRedisReady as jest.MockedFunction<typeof isRedisReady>;
const mockGetRedisConnection = getRedisConnection as jest.MockedFunction<typeof getRedisConnection>;
const mockCaptureMessage = Sentry.captureMessage as jest.MockedFunction<typeof Sentry.captureMessage>;

describe('RATE_LIMITS', () => {
  it('should have syncLatest at 60 seconds', () => {
    expect(RATE_LIMITS.syncLatest).toBe(60);
  });

  it('should have backfillStart at 24 hours', () => {
    expect(RATE_LIMITS.backfillStart).toBe(24 * 60 * 60);
  });
});

describe('ADMIN_RATE_LIMITS', () => {
  it('should have activation at 10 seconds', () => {
    expect(ADMIN_RATE_LIMITS.activation).toBe(10);
  });

  it('should have createUser at 5 seconds', () => {
    expect(ADMIN_RATE_LIMITS.createUser).toBe(5);
  });

  it('should have demoteUser at 5 seconds', () => {
    expect(ADMIN_RATE_LIMITS.demoteUser).toBe(5);
  });
});

describe('LOCK_TTL', () => {
  it('should have sync lock at 5 minutes', () => {
    expect(LOCK_TTL.sync).toBe(5 * 60);
  });

  it('should have backfill lock at 10 minutes', () => {
    expect(LOCK_TTL.backfill).toBe(10 * 60);
  });
});

describe('checkRateLimit', () => {
  let mockRedis: {
    set: jest.Mock;
    ttl: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      set: jest.fn(),
      ttl: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('should allow operation when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await checkRateLimit('syncLatest', 'strava', 'user123');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should allow operation when key is set successfully', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    const result = await checkRateLimit('syncLatest', 'strava', 'user123');

    expect(result).toEqual({ allowed: true, redisAvailable: true });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'rl:syncLatest:strava:user123',
      expect.any(String),
      'EX',
      60,
      'NX'
    );
  });

  it('should deny operation when key already exists', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue(null);
    mockRedis.ttl.mockResolvedValue(45);

    const result = await checkRateLimit('syncLatest', 'strava', 'user123');

    expect(result).toEqual({ allowed: false, retryAfter: 45, redisAvailable: true });
  });

  it('should use operation TTL when Redis TTL is invalid', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue(null);
    mockRedis.ttl.mockResolvedValue(-1); // Key exists but has no expiry

    const result = await checkRateLimit('syncLatest', 'strava', 'user123');

    expect(result).toEqual({ allowed: false, retryAfter: 60, redisAvailable: true });
  });

  it('should allow operation when Redis throws error', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockRejectedValue(new Error('Connection refused'));

    const result = await checkRateLimit('syncLatest', 'strava', 'user123');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
  });

  it('should use correct TTL for backfillStart', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    await checkRateLimit('backfillStart', 'garmin', 'user456');

    expect(mockRedis.set).toHaveBeenCalledWith(
      'rl:backfillStart:garmin:user456',
      expect.any(String),
      'EX',
      86400,
      'NX'
    );
  });
});

describe('checkAdminRateLimit', () => {
  let mockRedis: {
    set: jest.Mock;
    ttl: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      set: jest.fn(),
      ttl: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('should allow operation when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await checkAdminRateLimit('activation', 'user123');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should allow operation when key is set successfully', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    const result = await checkAdminRateLimit('activation', 'user123');

    expect(result).toEqual({ allowed: true, redisAvailable: true });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'rl:admin:activation:user123',
      expect.any(String),
      'EX',
      10,
      'NX'
    );
  });

  it('should deny operation when key already exists', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue(null);
    mockRedis.ttl.mockResolvedValue(8);

    const result = await checkAdminRateLimit('activation', 'user123');

    expect(result).toEqual({ allowed: false, retryAfter: 8, redisAvailable: true });
  });

  it('should use correct TTL for createUser', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    await checkAdminRateLimit('createUser', 'admin456');

    expect(mockRedis.set).toHaveBeenCalledWith(
      'rl:admin:createUser:admin456',
      expect.any(String),
      'EX',
      5,
      'NX'
    );
  });

  it('should use correct TTL for demoteUser', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    await checkAdminRateLimit('demoteUser', 'targetUser789');

    expect(mockRedis.set).toHaveBeenCalledWith(
      'rl:admin:demoteUser:targetUser789',
      expect.any(String),
      'EX',
      5,
      'NX'
    );
  });

  it('should allow operation when Redis throws error', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockRejectedValue(new Error('Connection refused'));

    const result = await checkAdminRateLimit('activation', 'user123');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
  });
});

describe('clearRateLimit', () => {
  let mockRedis: { del: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = { del: jest.fn() };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('should do nothing when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    await clearRateLimit('syncLatest', 'strava', 'user123');

    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('should delete the rate limit key', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.del.mockResolvedValue(1);

    await clearRateLimit('syncLatest', 'strava', 'user123');

    expect(mockRedis.del).toHaveBeenCalledWith('rl:syncLatest:strava:user123');
  });

  it('should fail silently when Redis throws error', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.del.mockRejectedValue(new Error('Connection failed'));

    await expect(clearRateLimit('syncLatest', 'strava', 'user123')).resolves.toBeUndefined();
  });
});

describe('acquireLock', () => {
  let mockRedis: { set: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = { set: jest.fn() };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('should return acquired=true without lock when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await acquireLock('sync', 'strava', 'user123');

    expect(result).toEqual({
      acquired: true,
      lockKey: null,
      lockValue: null,
      redisAvailable: false,
    });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should acquire lock successfully', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    const result = await acquireLock('sync', 'strava', 'user123');

    expect(result.acquired).toBe(true);
    expect(result.redisAvailable).toBe(true);
    expect((result as { lockKey: string }).lockKey).toBe('lock:strava:user123');
    expect((result as { lockValue: string }).lockValue).toMatch(/^\d+-[a-z0-9]+$/);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'lock:strava:user123',
      expect.any(String),
      'EX',
      300, // 5 minutes for sync
      'NX'
    );
  });

  it('should return acquired=false when lock already exists', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue(null);

    const result = await acquireLock('sync', 'strava', 'user123');

    expect(result).toEqual({ acquired: false, redisAvailable: true });
  });

  it('should use correct TTL for backfill lock', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockResolvedValue('OK');

    await acquireLock('backfill', 'garmin', 'user456');

    expect(mockRedis.set).toHaveBeenCalledWith(
      'lock:garmin:user456',
      expect.any(String),
      'EX',
      600, // 10 minutes for backfill
      'NX'
    );
  });

  it('should proceed without lock when Redis throws error', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.set.mockRejectedValue(new Error('Connection refused'));

    const result = await acquireLock('sync', 'strava', 'user123');

    expect(result).toEqual({
      acquired: true,
      lockKey: null,
      lockValue: null,
      redisAvailable: false,
    });
  });
});

describe('releaseLock', () => {
  let mockRedis: { eval: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = { eval: jest.fn() };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('should do nothing when lockKey is null', async () => {
    mockIsRedisReady.mockReturnValue(true);

    await releaseLock(null, 'value');

    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should do nothing when lockValue is null', async () => {
    mockIsRedisReady.mockReturnValue(true);

    await releaseLock('key', null);

    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should do nothing when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    await releaseLock('lock:strava:user123', 'value123');

    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should release lock with Lua script', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.eval.mockResolvedValue(1);

    await releaseLock('lock:strava:user123', 'value123');

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      'lock:strava:user123',
      'value123'
    );
  });

  it('should fail silently when Redis throws error', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.eval.mockRejectedValue(new Error('Connection failed'));

    await expect(releaseLock('lock:strava:user123', 'value123')).resolves.toBeUndefined();
  });
});

describe('extendLock', () => {
  let mockRedis: { eval: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = { eval: jest.fn() };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('should return false when lockKey is null', async () => {
    mockIsRedisReady.mockReturnValue(true);

    const result = await extendLock(null, 'value', 300);

    expect(result).toBe(false);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should return false when lockValue is null', async () => {
    mockIsRedisReady.mockReturnValue(true);

    const result = await extendLock('key', null, 300);

    expect(result).toBe(false);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should return false when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await extendLock('lock:strava:user123', 'value123', 300);

    expect(result).toBe(false);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('should extend lock and return true on success', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.eval.mockResolvedValue(1);

    const result = await extendLock('lock:strava:user123', 'value123', 600);

    expect(result).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("expire", KEYS[1], ARGV[2])'),
      1,
      'lock:strava:user123',
      'value123',
      600
    );
  });

  it('should return false when lock value does not match', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.eval.mockResolvedValue(0);

    const result = await extendLock('lock:strava:user123', 'wrong-value', 300);

    expect(result).toBe(false);
  });

  it('should return false when Redis throws error', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.eval.mockRejectedValue(new Error('Connection failed'));

    const result = await extendLock('lock:strava:user123', 'value123', 300);

    expect(result).toBe(false);
  });
});

describe('SUUNTO_QUOTA constant', () => {
  it('matches Suunto Developer API caps (10/min, 200/week, reject at 150)', () => {
    expect(SUUNTO_QUOTA).toEqual({
      perMinute: 10,
      perWeek: 200,
      weeklyStartRejectAt: 150,
    });
  });
});

/**
 * The window counters run through a script ioredis registers once per
 * connection (`defineCommand`), so the mock exposes both the registration hook
 * and the resulting `incrWithTtl` method.
 */
function mockCounterRedis(): { defineCommand: jest.Mock; incrWithTtl: jest.Mock } {
  return { defineCommand: jest.fn(), incrWithTtl: jest.fn() };
}

describe('checkMutationRateLimit', () => {
  let mockRedis: ReturnType<typeof mockCounterRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = mockCounterRedis();
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('allows a call under the cap', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([1, 60]);

    expect(await checkMutationRateLimit('updateUserPreferences', 'user123')).toEqual({
      allowed: true,
      redisAvailable: true,
    });
  });

  it('increments and expires in a single atomic call', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([1, 60]);

    await checkMutationRateLimit('updateUserPreferences', 'user123');

    // One round trip, carrying the window as the EXPIRE argument. A separate
    // INCR then EXPIRE could be interrupted between the two, stranding the key
    // without a TTL, and the counter would then never reset, leaving the user
    // rate limited on this mutation permanently.
    expect(mockRedis.incrWithTtl).toHaveBeenCalledTimes(1);
    expect(mockRedis.incrWithTtl).toHaveBeenCalledWith(
      'rl:mutation:updateUserPreferences:user123',
      String(MUTATION_RATE_LIMITS.updateUserPreferences.windowSeconds)
    );
  });

  it('registers the script once per connection, not per call', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([1, 60]);

    await checkMutationRateLimit('updateUserPreferences', 'user123');
    await checkMutationRateLimit('updateUserPreferences', 'user123');
    await checkMutationRateLimit('addRide', 'user456');

    // ioredis calls it by hash afterwards, so the body is not re-sent on a
    // path that runs for every rate-limited mutation and query.
    expect(mockRedis.defineCommand).toHaveBeenCalledTimes(1);
    expect(mockRedis.defineCommand).toHaveBeenCalledWith('incrWithTtl', {
      numberOfKeys: 1,
      lua: expect.any(String),
    });
  });

  it('rejects over the cap and reports the remaining window', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([21, 37]);

    const result = await checkMutationRateLimit('updateUserPreferences', 'user123');

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfter).toBe(37);
  });

  it('registers a script that re-arms the expiry on a counter that lost its TTL', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([21, 60]);

    await checkMutationRateLimit('updateUserPreferences', 'user123');

    // The repair branch is what lets an already-orphaned key age out on its
    // next hit instead of needing a manual DEL against production Redis.
    const { lua } = mockRedis.defineCommand.mock.calls[0][1] as { lua: string };
    expect(lua).toContain("redis.call('TTL', KEYS[1])");
    expect(lua).toMatch(/if ttl < 0 then\s+redis\.call\('EXPIRE', KEYS\[1\], ARGV\[1\]\)/);
  });

  it('falls back to the in-memory limiter when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await checkMutationRateLimit('updateUserPreferences', 'memory-user');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
    expect(mockRedis.incrWithTtl).not.toHaveBeenCalled();
  });

  it('falls back to the in-memory limiter when the script throws', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockRejectedValue(new Error('Connection failed'));

    const result = await checkMutationRateLimit('updateUserPreferences', 'throwing-user');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
  });
});

describe('checkQueryRateLimit', () => {
  let mockRedis: ReturnType<typeof mockCounterRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = mockCounterRedis();
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('rejects over the cap and reports the remaining window', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([21, 188]);

    const result = await checkQueryRateLimit('advisorSummary', 'user123');

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfter).toBe(188);
    expect(mockRedis.incrWithTtl).toHaveBeenCalledWith('rl:query:advisorSummary:user123', '300');
  });
});

describe('checkAuthRateLimit', () => {
  let mockRedis: ReturnType<typeof mockCounterRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = mockCounterRedis();
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('allows a signup attempt under the cap', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([1, 60]);

    expect(await checkAuthRateLimit('signup', '203.0.113.4')).toEqual({
      allowed: true,
      redisAvailable: true,
    });
  });

  it('keys on the caller identifier and carries the window as the TTL', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([1, 60]);

    await checkAuthRateLimit('forgot-password', '203.0.113.4');

    expect(mockRedis.incrWithTtl).toHaveBeenCalledTimes(1);
    expect(mockRedis.incrWithTtl).toHaveBeenCalledWith(
      'rl:auth:forgot-password:203.0.113.4',
      String(AUTH_RATE_LIMITS['forgot-password'].windowSeconds)
    );
  });

  it('rejects past the cap and reports the remaining window', async () => {
    mockIsRedisReady.mockReturnValue(true);
    // 6th signup from this IP in the minute, against a cap of 5.
    mockRedis.incrWithTtl.mockResolvedValue([6, 41]);

    const result = await checkAuthRateLimit('signup', '203.0.113.4');

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfter).toBe(41);
  });

  it('still rejects when the counter comes back without a usable TTL', async () => {
    mockIsRedisReady.mockReturnValue(true);
    // The script repairs a missing TTL, so this is belt and braces: a brute
    // force must never be waved through on the strength of a bad TTL read.
    mockRedis.incrWithTtl.mockResolvedValue([6, -1]);

    const result = await checkAuthRateLimit('signup', '203.0.113.4');

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfter).toBe(AUTH_RATE_LIMITS.signup.windowSeconds);
    }
  });

  it('falls back to the in-memory limiter when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await checkAuthRateLimit('signup', 'auth-memory-ip');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
    expect(mockRedis.incrWithTtl).not.toHaveBeenCalled();
  });

  it('falls back to the in-memory limiter when the script throws', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockRejectedValue(new Error('Connection failed'));

    const result = await checkAuthRateLimit('signup', 'auth-throwing-ip');

    expect(result).toEqual({ allowed: true, redisAvailable: false });
  });

  it('raises a Sentry report on the first rejection of the window', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([AUTH_RATE_LIMITS.signup.maxRequests + 1, 41]);

    await checkAuthRateLimit('signup', '203.0.113.4');

    // These rejections answer with a plain 429 from an Express route, so they
    // never went through the Apollo plugin and would otherwise land nowhere an
    // alert can see.
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'Auth rate limit tripped: signup',
      expect.objectContaining({
        level: 'warning',
        tags: { 'ratelimit.operation': 'signup' },
        extra: expect.objectContaining({ identifier: '203.0.113.4', operation: 'signup' }),
      })
    );
  });

  it('reports once per window however long the run continues', async () => {
    mockIsRedisReady.mockReturnValue(true);
    const { maxRequests } = AUTH_RATE_LIMITS.signup;
    // One crossing, then a thousand more requests behind it.
    mockRedis.incrWithTtl
      .mockResolvedValueOnce([maxRequests + 1, 41])
      .mockResolvedValueOnce([maxRequests + 2, 40])
      .mockResolvedValueOnce([maxRequests + 900, 12]);

    await checkAuthRateLimit('signup', '203.0.113.4');
    await checkAuthRateLimit('signup', '203.0.113.4');
    await checkAuthRateLimit('signup', '203.0.113.4');

    // A credential-stuffing run must be one alert, not one per request.
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });

  it('does not report while the caller is under the cap', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValue([AUTH_RATE_LIMITS.signup.maxRequests, 41]);

    await checkAuthRateLimit('signup', '203.0.113.4');

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('still reports when Redis is down and the in-memory limiter is holding', async () => {
    mockIsRedisReady.mockReturnValue(false);
    const ip = 'auth-report-fallback-ip';
    const { maxRequests } = AUTH_RATE_LIMITS.signup;

    for (let i = 0; i < maxRequests + 3; i++) {
      await checkAuthRateLimit('signup', ip);
    }

    // A Redis outage is exactly when an attacker would like the alerting to go
    // quiet, so the fallback path reports on its own first crossing too.
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'Auth rate limit tripped: signup',
      expect.objectContaining({ extra: expect.objectContaining({ identifier: ip }) })
    );
  });

  it('caps a brute force at maxRequests once the in-memory limiter takes over', async () => {
    mockIsRedisReady.mockReturnValue(false);
    const ip = 'auth-burst-ip';
    const { maxRequests } = AUTH_RATE_LIMITS.signup;

    const results = [];
    for (let i = 0; i < maxRequests + 2; i++) {
      results.push(await checkAuthRateLimit('signup', ip));
    }

    // The Redis outage must not become an open door: the fallback still holds
    // the same cap for the window.
    expect(results.filter((r) => r.allowed)).toHaveLength(maxRequests);
    expect(results.filter((r) => !r.allowed)).toHaveLength(2);
  });
});

describe('acquireSuuntoApiCall', () => {
  let mockRedis: {
    defineCommand: jest.Mock;
    incrWithTtl: jest.Mock;
    decr: jest.Mock;
    get: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      // Both counters now go through the INCR-plus-TTL script, which returns
      // [count, ttl] in one round trip.
      ...mockCounterRedis(),
      decr: jest.fn(),
      get: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('allows the call when both counters are well under cap', async () => {
    mockIsRedisReady.mockReturnValue(true);
    // First eval is the minute counter, second is the week counter.
    mockRedis.incrWithTtl.mockResolvedValueOnce([1, 90]).mockResolvedValueOnce([1, 691200]);

    const result = await acquireSuuntoApiCall();

    expect(result).toEqual({
      allowed: true,
      minuteCount: 1,
      weekCount: 1,
      redisAvailable: true,
    });
  });

  it('passes each bucket its own TTL to the counter script', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValueOnce([5, 40]).mockResolvedValueOnce([42, 600000]);

    await acquireSuuntoApiCall();

    // 90s for the minute bucket, 8 days for the week bucket, both as the
    // script's EXPIRE argument.
    expect(mockRedis.incrWithTtl).toHaveBeenNthCalledWith(
      1, expect.stringContaining('rl:suunto:quota:minute'), '90'
    );
    expect(mockRedis.incrWithTtl).toHaveBeenNthCalledWith(
      2, expect.stringContaining('rl:suunto:quota:week'), String(8 * 24 * 60 * 60)
    );
  });

  it('denies when the per-minute cap is hit and rolls back BOTH counters', async () => {
    mockIsRedisReady.mockReturnValue(true);
    // 11th call in the minute → over 10/min cap.
    mockRedis.incrWithTtl.mockResolvedValueOnce([11, 35]).mockResolvedValueOnce([50, 600000]);
    mockRedis.decr.mockResolvedValue(10);

    const result = await acquireSuuntoApiCall();

    // Both counters reflect the rollback: a denied call doesn't actually
    // hit Suunto's API, so it shouldn't burn either the per-minute or the
    // weekly slot. Without the week rollback, a 20-call burst would burn
    // 20 of the 200 weekly slots and trip the start-rejection gate early.
    expect(result).toEqual({
      allowed: false,
      retryAfter: 35,
      minuteCount: 10,
      weekCount: 49,
      redisAvailable: true,
    });
    expect(mockRedis.decr).toHaveBeenCalledTimes(2);
  });

  it('falls back to retryAfter=60 when TTL is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockResolvedValueOnce([11, -1]).mockResolvedValueOnce([50, 600000]);
    mockRedis.decr.mockResolvedValue(10);

    const result = await acquireSuuntoApiCall();

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.retryAfter).toBe(60);
  });

  it('allows the call (graceful degradation) when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    const result = await acquireSuuntoApiCall();

    expect(result).toEqual({
      allowed: true,
      minuteCount: 0,
      weekCount: 0,
      redisAvailable: false,
    });
  });

  it('allows the call when Redis throws (graceful degradation)', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incrWithTtl.mockRejectedValue(new Error('Connection failed'));

    const result = await acquireSuuntoApiCall();

    expect(result).toEqual({
      allowed: true,
      minuteCount: 0,
      weekCount: 0,
      redisAvailable: false,
    });
  });
});

describe('getSuuntoWeekCount', () => {
  let mockRedis: { get: jest.Mock };

  beforeEach(() => {
    mockRedis = { get: jest.fn() };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('returns the parsed integer count for the current week', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.get.mockResolvedValue('148');

    const count = await getSuuntoWeekCount();

    expect(count).toBe(148);
  });

  it('returns 0 when no key exists yet', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.get.mockResolvedValue(null);

    expect(await getSuuntoWeekCount()).toBe(0);
  });

  it('returns 0 (graceful degradation) when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);

    expect(await getSuuntoWeekCount()).toBe(0);
  });

  it('returns 0 when Redis throws', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.get.mockRejectedValue(new Error('Connection failed'));

    expect(await getSuuntoWeekCount()).toBe(0);
  });
});
