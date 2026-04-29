// Mock redis before importing
jest.mock('./redis', () => ({
  isRedisReady: jest.fn(),
  getRedisConnection: jest.fn(),
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
} from './rate-limit';
import { isRedisReady, getRedisConnection } from './redis';

const mockIsRedisReady = isRedisReady as jest.MockedFunction<typeof isRedisReady>;
const mockGetRedisConnection = getRedisConnection as jest.MockedFunction<typeof getRedisConnection>;

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

describe('acquireSuuntoApiCall', () => {
  let mockRedis: {
    incr: jest.Mock;
    decr: jest.Mock;
    expire: jest.Mock;
    ttl: jest.Mock;
    get: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      incr: jest.fn(),
      decr: jest.fn(),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn(),
      get: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  it('allows the call when both counters are well under cap', async () => {
    mockIsRedisReady.mockReturnValue(true);
    // First INCR is the minute counter, second is the week counter.
    mockRedis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const result = await acquireSuuntoApiCall();

    expect(result).toEqual({
      allowed: true,
      minuteCount: 1,
      weekCount: 1,
      redisAvailable: true,
    });
    // First-hit-of-bucket TTLs should be set on both counters.
    expect(mockRedis.expire).toHaveBeenCalledTimes(2);
  });

  it('does not re-set the expiry on subsequent calls in the same bucket', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockRedis.incr.mockResolvedValueOnce(5).mockResolvedValueOnce(42);

    const result = await acquireSuuntoApiCall();

    expect(result.allowed).toBe(true);
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it('denies when the per-minute cap is hit and rolls back BOTH counters', async () => {
    mockIsRedisReady.mockReturnValue(true);
    // 11th call in the minute → over 10/min cap.
    mockRedis.incr.mockResolvedValueOnce(11).mockResolvedValueOnce(50);
    mockRedis.decr.mockResolvedValue(10);
    mockRedis.ttl.mockResolvedValue(35);

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
    mockRedis.incr.mockResolvedValueOnce(11).mockResolvedValueOnce(50);
    mockRedis.decr.mockResolvedValue(10);
    mockRedis.ttl.mockResolvedValue(-1);

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
    mockRedis.incr.mockRejectedValue(new Error('Connection failed'));

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
