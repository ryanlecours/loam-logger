import { getRedisConnection, isRedisReady } from './redis';
import type { SyncProvider } from './queue';

// Time constants in seconds (for Redis TTL)
const SECONDS = 1;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;

/**
 * Rate limit configuration for different sync operations.
 * Values are in seconds.
 */
export const RATE_LIMITS = {
  /** Latest sync cooldown: 60 seconds per user per provider */
  syncLatest: 60 * SECONDS,
  /** Backfill start cooldown: 24 hours per user per provider */
  backfillStart: 24 * HOURS,
} as const;

/**
 * Rate limit configuration for admin actions.
 * Values are in seconds.
 */
export const ADMIN_RATE_LIMITS = {
  /** Activation cooldown: 10 seconds per target user (prevents email flood) */
  activation: 10 * SECONDS,
  /** User creation cooldown: 5 seconds per admin (prevents accidental spam) */
  createUser: 5 * SECONDS,
  /** User demotion cooldown: 5 seconds per target user (prevents accidental spam) */
  demoteUser: 5 * SECONDS,
} as const;

export type AdminRateLimitType = keyof typeof ADMIN_RATE_LIMITS;

export type RateLimitType = keyof typeof RATE_LIMITS;

/**
 * Result of a rate limit check.
 */
export type RateLimitResult =
  | { allowed: true; redisAvailable: boolean }
  | { allowed: false; retryAfter: number; redisAvailable: boolean };

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
 * Graceful degradation: If Redis is unavailable, allows the operation
 * but logs a warning. This prevents Redis outages from blocking all sync operations.
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
  // Graceful degradation: allow operation if Redis is unavailable
  if (!isRedisReady()) {
    console.warn(
      `[RateLimit] Redis unavailable, allowing ${operation} for ${provider}:${userId}`
    );
    return { allowed: true, redisAvailable: false };
  }

  try {
    const redis = getRedisConnection();
    const key = buildRateLimitKey(operation, provider, userId);
    const ttlSeconds = RATE_LIMITS[operation];

    // Try to set the key with NX (only if not exists) and EX (expiry)
    const result = await redis.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');

    if (result === 'OK') {
      // Key was set, operation is allowed
      return { allowed: true, redisAvailable: true };
    }

    // Key already exists, get TTL to calculate retryAfter
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : ttlSeconds,
      redisAvailable: true,
    };
  } catch (err) {
    // Redis operation failed, allow the operation but log warning
    console.warn(
      `[RateLimit] Redis error during ${operation} check for ${provider}:${userId}, allowing operation:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { allowed: true, redisAvailable: false };
  }
}

/**
 * Build a rate limit key for admin actions.
 * Format: rl:admin:<operation>:<targetId>
 */
function buildAdminRateLimitKey(
  operation: AdminRateLimitType,
  targetId: string
): string {
  return `rl:admin:${operation}:${targetId}`;
}

/**
 * Check if an admin action is rate limited and set the rate limit if allowed.
 * Used to prevent abuse like email flooding via activation endpoint.
 *
 * @param operation - The type of admin operation (activation)
 * @param targetId - The target user/entity ID
 * @returns Whether the operation is allowed, and retryAfter seconds if not
 */
export async function checkAdminRateLimit(
  operation: AdminRateLimitType,
  targetId: string
): Promise<RateLimitResult> {
  // Graceful degradation: allow operation if Redis is unavailable
  if (!isRedisReady()) {
    console.warn(
      `[RateLimit] Redis unavailable, allowing admin ${operation} for ${targetId}`
    );
    return { allowed: true, redisAvailable: false };
  }

  try {
    const redis = getRedisConnection();
    const key = buildAdminRateLimitKey(operation, targetId);
    const ttlSeconds = ADMIN_RATE_LIMITS[operation];

    // Try to set the key with NX (only if not exists) and EX (expiry)
    const result = await redis.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');

    if (result === 'OK') {
      return { allowed: true, redisAvailable: true };
    }

    // Key already exists, get TTL to calculate retryAfter
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : ttlSeconds,
      redisAvailable: true,
    };
  } catch (err) {
    console.warn(
      `[RateLimit] Redis error during admin ${operation} check for ${targetId}, allowing operation:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { allowed: true, redisAvailable: false };
  }
}

/**
 * Clear a rate limit (useful for testing or admin override).
 * Fails silently if Redis is unavailable.
 */
export async function clearRateLimit(
  operation: RateLimitType,
  provider: SyncProvider,
  userId: string
): Promise<void> {
  if (!isRedisReady()) {
    console.warn(`[RateLimit] Redis unavailable, cannot clear ${operation} for ${provider}:${userId}`);
    return;
  }

  try {
    const redis = getRedisConnection();
    const key = buildRateLimitKey(operation, provider, userId);
    await redis.del(key);
  } catch (err) {
    console.warn(
      `[RateLimit] Failed to clear ${operation} for ${provider}:${userId}:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
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
  | { acquired: true; lockKey: string; lockValue: string; redisAvailable: true }
  | { acquired: true; lockKey: null; lockValue: null; redisAvailable: false }
  | { acquired: false; redisAvailable: boolean };

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
 * Graceful degradation: If Redis is unavailable, returns acquired=true but
 * with null key/value. The caller should handle this case (no lock to release).
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
  // Graceful degradation: proceed without lock if Redis is unavailable
  if (!isRedisReady()) {
    console.warn(
      `[Lock] Redis unavailable, proceeding without lock for ${lockType}:${provider}:${userId}`
    );
    return { acquired: true, lockKey: null, lockValue: null, redisAvailable: false };
  }

  try {
    const redis = getRedisConnection();
    const lockKey = buildLockKey(provider, userId);
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ttlSeconds = LOCK_TTL[lockType];

    const result = await redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');

    if (result === 'OK') {
      return { acquired: true, lockKey, lockValue, redisAvailable: true };
    }

    return { acquired: false, redisAvailable: true };
  } catch (err) {
    // Redis operation failed, proceed without lock
    console.warn(
      `[Lock] Redis error during lock acquisition for ${lockType}:${provider}:${userId}, proceeding without lock:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { acquired: true, lockKey: null, lockValue: null, redisAvailable: false };
  }
}

/**
 * Release a distributed lock.
 * Only releases if the lock value matches (prevents releasing another process's lock).
 * Fails silently if Redis is unavailable or if the lock wasn't acquired via Redis.
 *
 * @param lockKey - The lock key (null if lock wasn't acquired via Redis)
 * @param lockValue - The lock value (null if lock wasn't acquired via Redis)
 */
export async function releaseLock(lockKey: string | null, lockValue: string | null): Promise<void> {
  // Nothing to release if lock wasn't acquired via Redis
  if (!lockKey || !lockValue) {
    return;
  }

  if (!isRedisReady()) {
    console.warn(`[Lock] Redis unavailable, cannot release lock ${lockKey}`);
    return;
  }

  try {
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
  } catch (err) {
    console.warn(
      `[Lock] Failed to release lock ${lockKey}:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
}

/**
 * Extend a lock's TTL (useful for long-running operations).
 * Only extends if the lock value matches.
 * Returns false if Redis is unavailable.
 *
 * @param lockKey - The lock key (null if lock wasn't acquired via Redis)
 * @param lockValue - The lock value (null if lock wasn't acquired via Redis)
 * @param ttlSeconds - New TTL in seconds
 * @returns Whether the extension was successful
 */
export async function extendLock(
  lockKey: string | null,
  lockValue: string | null,
  ttlSeconds: number
): Promise<boolean> {
  // Can't extend a lock that wasn't acquired via Redis
  if (!lockKey || !lockValue) {
    return false;
  }

  if (!isRedisReady()) {
    console.warn(`[Lock] Redis unavailable, cannot extend lock ${lockKey}`);
    return false;
  }

  try {
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
  } catch (err) {
    console.warn(
      `[Lock] Failed to extend lock ${lockKey}:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return false;
  }
}
