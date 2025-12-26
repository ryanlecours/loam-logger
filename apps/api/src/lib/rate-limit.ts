import { getRedisConnection } from './redis';
import type { SyncProvider } from './queue';

/**
 * Rate limit configuration for different sync operations.
 */
export const RATE_LIMITS = {
  /** Latest sync cooldown: 60 seconds per user per provider */
  syncLatest: 60,
  /** Backfill start cooldown: 24 hours per user per provider */
  backfillStart: 24 * 60 * 60,
} as const;

export type RateLimitType = keyof typeof RATE_LIMITS;

/**
 * Result of a rate limit check.
 */
export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

/**
 * Build a rate limit key.
 * Format: rl:<operation>:<provider>:<userId>
 */
function buildRateLimitKey(
  operation: RateLimitType,
  provider: SyncProvider,
  userId: string
): string {
  return `rl:${operation}:${provider}:${userId}`;
}

/**
 * Check if an operation is rate limited and set the rate limit if allowed.
 * Uses Redis SET NX EX pattern for atomic check-and-set.
 *
 * @param operation - The type of operation (syncLatest, backfillStart)
 * @param provider - The provider (strava, garmin, suunto)
 * @param userId - The user ID
 * @returns Whether the operation is allowed, and retryAfter seconds if not
 */
export async function checkRateLimit(
  operation: RateLimitType,
  provider: SyncProvider,
  userId: string
): Promise<RateLimitResult> {
  const redis = getRedisConnection();
  const key = buildRateLimitKey(operation, provider, userId);
  const ttlSeconds = RATE_LIMITS[operation];

  // Try to set the key with NX (only if not exists) and EX (expiry)
  const result = await redis.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');

  if (result === 'OK') {
    // Key was set, operation is allowed
    return { allowed: true };
  }

  // Key already exists, get TTL to calculate retryAfter
  const ttl = await redis.ttl(key);
  return {
    allowed: false,
    retryAfter: ttl > 0 ? ttl : ttlSeconds,
  };
}

/**
 * Clear a rate limit (useful for testing or admin override).
 */
export async function clearRateLimit(
  operation: RateLimitType,
  provider: SyncProvider,
  userId: string
): Promise<void> {
  const redis = getRedisConnection();
  const key = buildRateLimitKey(operation, provider, userId);
  await redis.del(key);
}

/**
 * Distributed lock configuration for sync operations.
 */
export const LOCK_TTL = {
  /** Lock TTL for sync operations: 5 minutes */
  sync: 5 * 60,
  /** Lock TTL for backfill operations: 10 minutes */
  backfill: 10 * 60,
} as const;

export type LockType = keyof typeof LOCK_TTL;

/**
 * Result of acquiring a lock.
 */
export type LockResult =
  | { acquired: true; lockKey: string; lockValue: string }
  | { acquired: false };

/**
 * Build a lock key.
 * Format: lock:<provider>:<userId>
 */
function buildLockKey(provider: SyncProvider, userId: string): string {
  return `lock:${provider}:${userId}`;
}

/**
 * Acquire a distributed lock for a sync operation.
 * Uses Redis SET NX EX pattern with a unique value for safe release.
 *
 * @param lockType - The type of lock (sync, backfill)
 * @param provider - The provider
 * @param userId - The user ID
 * @returns Lock result with key and value if acquired
 */
export async function acquireLock(
  lockType: LockType,
  provider: SyncProvider,
  userId: string
): Promise<LockResult> {
  const redis = getRedisConnection();
  const lockKey = buildLockKey(provider, userId);
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ttlSeconds = LOCK_TTL[lockType];

  const result = await redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');

  if (result === 'OK') {
    return { acquired: true, lockKey, lockValue };
  }

  return { acquired: false };
}

/**
 * Release a distributed lock.
 * Only releases if the lock value matches (prevents releasing another process's lock).
 *
 * @param lockKey - The lock key
 * @param lockValue - The lock value (must match the value used to acquire)
 */
export async function releaseLock(lockKey: string, lockValue: string): Promise<void> {
  const redis = getRedisConnection();

  // Use Lua script for atomic check-and-delete
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  await redis.eval(script, 1, lockKey, lockValue);
}

/**
 * Extend a lock's TTL (useful for long-running operations).
 * Only extends if the lock value matches.
 *
 * @param lockKey - The lock key
 * @param lockValue - The lock value
 * @param ttlSeconds - New TTL in seconds
 * @returns Whether the extension was successful
 */
export async function extendLock(
  lockKey: string,
  lockValue: string,
  ttlSeconds: number
): Promise<boolean> {
  const redis = getRedisConnection();

  // Use Lua script for atomic check-and-extend
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  const result = await redis.eval(script, 1, lockKey, lockValue, ttlSeconds);
  return result === 1;
}
