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
 * Rate limit configuration for mutations.
 * Uses a sliding window approach with max requests per window.
 */
export const MUTATION_RATE_LIMITS = {
  /** addRide: max 30 requests per minute per user */
  addRide: { windowSeconds: 60, maxRequests: 30 },
  /** updateRide: max 30 requests per minute per user */
  updateRide: { windowSeconds: 60, maxRequests: 30 },
  /** deleteRide: max 30 requests per minute per user */
  deleteRide: { windowSeconds: 60, maxRequests: 30 },
  /** logService: max 20 requests per minute per user */
  logService: { windowSeconds: 60, maxRequests: 20 },
  /** logComponentService (reset hours): max 20 requests per minute per user */
  logComponentService: { windowSeconds: 60, maxRequests: 20 },
  /** updateServiceLog: max 30 requests per minute per user */
  updateServiceLog: { windowSeconds: 60, maxRequests: 30 },
  /** deleteServiceLog: max 30 requests per minute per user */
  deleteServiceLog: { windowSeconds: 60, maxRequests: 30 },
  /** updateBikeComponentInstall: max 30 requests per minute per user */
  updateBikeComponentInstall: { windowSeconds: 60, maxRequests: 30 },
  /** deleteBikeComponentInstall: max 30 requests per minute per user */
  deleteBikeComponentInstall: { windowSeconds: 60, maxRequests: 30 },
  /** updateBikeAcquisition: max 20 requests per minute per user */
  updateBikeAcquisition: { windowSeconds: 60, maxRequests: 20 },
  /** bulkUpdateBikeComponentInstalls: max 20 requests per minute per user */
  bulkUpdateBikeComponentInstalls: { windowSeconds: 60, maxRequests: 20 },
  /**
   * bikeHistory query: max 60 requests per minute per user. Higher than
   * mutations because it's a read (filter toggling, timeframe changes,
   * cache-and-network refetches all hit it), but capped to prevent a
   * polling loop from saturating the DB — each call fires up to three
   * findMany queries returning ~4k rows combined.
   */
  bikeHistory: { windowSeconds: 60, maxRequests: 60 },
  /** logBulkComponentService (calibration): max 20 requests per minute per user */
  logBulkComponentService: { windowSeconds: 60, maxRequests: 20 },
  /** updateComponent: max 30 requests per minute per user */
  updateComponent: { windowSeconds: 60, maxRequests: 30 },
  /** createStravaGearMapping: max 10 requests per minute per user */
  createStravaGearMapping: { windowSeconds: 60, maxRequests: 10 },
  /** deleteStravaGearMapping: max 10 requests per minute per user */
  deleteStravaGearMapping: { windowSeconds: 60, maxRequests: 10 },
  /** bulkUpdateComponentBaselines: max 10 requests per minute per user */
  bulkUpdateComponentBaselines: { windowSeconds: 60, maxRequests: 10 },
  /** assignBikeToRides: max 20 requests per minute per user */
  assignBikeToRides: { windowSeconds: 60, maxRequests: 20 },
  /** snoozeComponent: max 20 requests per minute per user */
  snoozeComponent: { windowSeconds: 60, maxRequests: 20 },
  /** migratePairedComponents: max 5 requests per minute per user (one-time migration) */
  migratePairedComponents: { windowSeconds: 60, maxRequests: 5 },
  /** replaceComponent: max 20 requests per minute per user */
  replaceComponent: { windowSeconds: 60, maxRequests: 20 },
  /** markPairedComponentMigrationSeen: max 10 requests per minute per user */
  markPairedComponentMigrationSeen: { windowSeconds: 60, maxRequests: 10 },
  /** updateServicePreferences: max 10 requests per minute per user */
  updateServicePreferences: { windowSeconds: 60, maxRequests: 10 },
  /** updateBikeServicePreferences: max 10 requests per minute per user */
  updateBikeServicePreferences: { windowSeconds: 60, maxRequests: 10 },
  /** installComponent: max 20 requests per minute per user */
  installComponent: { windowSeconds: 60, maxRequests: 20 },
  /** swapComponents: max 20 requests per minute per user */
  swapComponents: { windowSeconds: 60, maxRequests: 20 },
  /** addBikeNote: max 20 requests per minute per user */
  addBikeNote: { windowSeconds: 60, maxRequests: 20 },
  /** deleteBikeNote: max 20 requests per minute per user */
  deleteBikeNote: { windowSeconds: 60, maxRequests: 20 },
  /** addPassword: max 5 requests per hour per user (sensitive credential operation) */
  addPassword: { windowSeconds: 3600, maxRequests: 5 },
  /** changePassword: max 5 requests per hour per user (sensitive credential operation) */
  changePassword: { windowSeconds: 3600, maxRequests: 5 },
  /** oauthStart: max 5 requests per 10 minutes per user (creates DB row each call) */
  oauthStart: { windowSeconds: 600, maxRequests: 5 },
  /** updateUserPreferences: max 20 requests per minute per user */
  updateUserPreferences: { windowSeconds: 60, maxRequests: 20 },
  /** updateAnalyticsOptOut: max 10 toggles per hour per user. Users rarely flip
   *  this — a tight cap bounds cache-invalidation abuse without impacting
   *  legitimate usage. */
  updateAnalyticsOptOut: { windowSeconds: 3600, maxRequests: 10 },
  /** updateBikeNotificationPreference: max 20 requests per minute per user */
  updateBikeNotificationPreference: { windowSeconds: 60, maxRequests: 20 },
  /** backfillWeatherForMyRides: max 3 requests per 5 minutes. Each call
   *  enqueues up to BATCH_LIMIT (500) jobs against Open-Meteo, so the limit
   *  exists to stop a runaway client loop while still allowing legitimate
   *  "Fetch more" clicks to drain a large history over a few batches. */
  backfillWeatherForMyRides: { windowSeconds: 300, maxRequests: 3 },
} as const;

/**
 * Rate limit configuration for polling queries.
 * Uses a sliding window approach with max requests per window.
 */
export const QUERY_RATE_LIMITS = {
  /** unassignedRides: max 60 requests per minute per user (supports ~1 req/sec polling) */
  unassignedRides: { windowSeconds: 60, maxRequests: 60 },
  /** importNotificationState: max 30 requests per minute per user (supports 30s polling) */
  importNotificationState: { windowSeconds: 60, maxRequests: 30 },
} as const;

export type QueryRateLimitType = keyof typeof QUERY_RATE_LIMITS;

export type MutationRateLimitType = keyof typeof MUTATION_RATE_LIMITS;

/**
 * In-memory rate limit fallback when Redis is unavailable.
 * Uses a simple sliding window counter per operation:userId.
 */
const memoryRateLimits = new Map<
  string,
  { count: number; resetAt: number }
>();

/** Maximum entries in memory rate limit cache */
const MEMORY_RATE_LIMIT_MAX_SIZE = 1000;

/**
 * Clean up expired entries from memory rate limit cache.
 */
function cleanupMemoryRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of memoryRateLimits) {
    if (entry.resetAt <= now) {
      memoryRateLimits.delete(key);
    }
  }
}

/**
 * Check rate limit using in-memory fallback.
 * Used when Redis is unavailable.
 */
function checkMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // Clean up periodically (every 100 checks or when cache is large)
  if (memoryRateLimits.size > MEMORY_RATE_LIMIT_MAX_SIZE) {
    cleanupMemoryRateLimits();
  }

  const entry = memoryRateLimits.get(key);

  if (!entry || entry.resetAt <= now) {
    // Start new window
    memoryRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, redisAvailable: false };
  }

  // Increment counter
  entry.count++;

  if (entry.count <= maxRequests) {
    return { allowed: true, redisAvailable: false };
  }

  // Rate limited
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  return {
    allowed: false,
    retryAfter: retryAfter > 0 ? retryAfter : windowSeconds,
    redisAvailable: false,
  };
}

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
  /** Password reset email cooldown: 30 seconds per target user (prevents accidental double-click + email spam) */
  sendPasswordReset: 30 * SECONDS,
  /** Bulk email cooldown: 60 seconds per admin (prevents spam) */
  bulkEmail: 60 * SECONDS,
  /** Waitlist import cooldown: 60 seconds per admin (prevents spam) */
  importWaitlist: 60 * SECONDS,
} as const;

/**
 * Rate limit configuration for public auth endpoints.
 * Uses a sliding window approach with max requests per window.
 */
export const AUTH_RATE_LIMITS = {
  /** signup: max 5 requests per minute per IP (prevents automated spam) */
  signup: { windowSeconds: 60, maxRequests: 5 },
  /** oauth-login: max 10 requests per minute per IP (Google/Apple token verification) */
  'oauth-login': { windowSeconds: 60, maxRequests: 10 },
  /** public-stats: max 30 requests per minute per IP (cached endpoint, prevent abuse) */
  'public-stats': { windowSeconds: 60, maxRequests: 30 },
  /** reset-password: max 10 requests per minute per IP (prevents token-guessing floods) */
  'reset-password': { windowSeconds: 60, maxRequests: 10 },
  /** forgot-password: max 5 requests per minute per IP (public; prevents email-blast abuse) */
  'forgot-password': { windowSeconds: 60, maxRequests: 5 },
} as const;

export type AuthRateLimitType = keyof typeof AUTH_RATE_LIMITS;

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
 * Build a rate limit key for mutation operations.
 * Format: rl:mutation:<operation>:<userId>
 */
function buildMutationRateLimitKey(
  operation: MutationRateLimitType,
  userId: string
): string {
  return `rl:mutation:${operation}:${userId}`;
}

/**
 * Check if a mutation is rate limited using a sliding window counter.
 * Uses Redis INCR with EXPIRE for simple and efficient rate limiting.
 *
 * Graceful degradation: Falls back to in-memory rate limiting if Redis is unavailable.
 *
 * @param operation - The mutation type
 * @param userId - The user ID
 * @returns Whether the operation is allowed, and retryAfter seconds if not
 */
export async function checkMutationRateLimit(
  operation: MutationRateLimitType,
  userId: string
): Promise<RateLimitResult> {
  const config = MUTATION_RATE_LIMITS[operation];
  const key = buildMutationRateLimitKey(operation, userId);

  // Fallback to in-memory rate limiting if Redis is unavailable
  if (!isRedisReady()) {
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds);
  }

  try {
    const redis = getRedisConnection();

    // Increment the counter
    const count = await redis.incr(key);

    // Set expiry on first request in the window
    if (count === 1) {
      await redis.expire(key, config.windowSeconds);
    }

    if (count <= config.maxRequests) {
      return { allowed: true, redisAvailable: true };
    }

    // Rate limited - get TTL for retry info
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : config.windowSeconds,
      redisAvailable: true,
    };
  } catch (err) {
    // Redis operation failed, fall back to in-memory rate limiting
    console.warn(
      `[RateLimit] Redis error during mutation ${operation} check for ${userId}, using in-memory fallback:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds);
  }
}

/**
 * Build a rate limit key for query operations.
 * Format: rl:query:<operation>:<userId>
 */
function buildQueryRateLimitKey(
  operation: QueryRateLimitType,
  userId: string
): string {
  return `rl:query:${operation}:${userId}`;
}

/**
 * Check if a polling query is rate limited using a sliding window counter.
 * Used to prevent abuse of frequently-polled queries.
 *
 * Graceful degradation: Falls back to in-memory rate limiting if Redis is unavailable.
 *
 * @param operation - The query type
 * @param userId - The user ID
 * @returns Whether the operation is allowed, and retryAfter seconds if not
 */
export async function checkQueryRateLimit(
  operation: QueryRateLimitType,
  userId: string
): Promise<RateLimitResult> {
  const config = QUERY_RATE_LIMITS[operation];
  const key = buildQueryRateLimitKey(operation, userId);

  // Fallback to in-memory rate limiting if Redis is unavailable
  if (!isRedisReady()) {
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds);
  }

  try {
    const redis = getRedisConnection();

    // Increment the counter
    const count = await redis.incr(key);

    // Set expiry on first request in the window
    if (count === 1) {
      await redis.expire(key, config.windowSeconds);
    }

    if (count <= config.maxRequests) {
      return { allowed: true, redisAvailable: true };
    }

    // Rate limited - get TTL for retry info
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : config.windowSeconds,
      redisAvailable: true,
    };
  } catch (err) {
    // Redis operation failed, fall back to in-memory rate limiting
    console.warn(
      `[RateLimit] Redis error during query ${operation} check for ${userId}, using in-memory fallback:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds);
  }
}

/**
 * Build a rate limit key for auth operations.
 * Format: rl:auth:<operation>:<identifier>
 */
function buildAuthRateLimitKey(
  operation: AuthRateLimitType,
  identifier: string
): string {
  return `rl:auth:${operation}:${identifier}`;
}

/**
 * Check if an auth operation is rate limited using a sliding window counter.
 * Used to prevent abuse of public endpoints like signup.
 *
 * Graceful degradation: Falls back to in-memory rate limiting if Redis is unavailable.
 *
 * @param operation - The auth operation type (signup)
 * @param identifier - The identifier (typically client IP)
 * @returns Whether the operation is allowed, and retryAfter seconds if not
 */
export async function checkAuthRateLimit(
  operation: AuthRateLimitType,
  identifier: string
): Promise<RateLimitResult> {
  const config = AUTH_RATE_LIMITS[operation];
  const key = buildAuthRateLimitKey(operation, identifier);

  // Fallback to in-memory rate limiting if Redis is unavailable
  if (!isRedisReady()) {
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds);
  }

  try {
    const redis = getRedisConnection();

    // Increment the counter
    const count = await redis.incr(key);

    // Set expiry on first request in the window
    if (count === 1) {
      await redis.expire(key, config.windowSeconds);
    }

    if (count <= config.maxRequests) {
      return { allowed: true, redisAvailable: true };
    }

    // Rate limited - get TTL for retry info
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : config.windowSeconds,
      redisAvailable: true,
    };
  } catch (err) {
    // Redis operation failed, fall back to in-memory rate limiting
    console.warn(
      `[RateLimit] Redis error during auth ${operation} check for ${identifier}, using in-memory fallback:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds);
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

// ----------------------------------------------------------------------------
// Suunto outbound API quota
// ----------------------------------------------------------------------------
//
// Suunto Developer API enforces 10 calls/minute and 200 calls/week per
// subscription key (we use one app-wide). Suunto support couldn't confirm
// whether OAuth refreshes count, so we throttle them too — better to over-
// throttle than to silently get 429ed by Suunto and have webhooks/backfills
// fail mid-flight.
//
// The per-minute throttle uses an INCR sliding window keyed by the current
// minute bucket. The weekly counter uses an INCR keyed by ISO week. Both
// share the same `acquireSuuntoApiCall` entrypoint so every outbound call
// updates both counters atomically.

export const SUUNTO_QUOTA = {
  /** Hard cap from Suunto: 10 calls/minute per subscription. */
  perMinute: 10,
  /** Hard cap from Suunto: 200 calls/week per subscription. */
  perWeek: 200,
  /**
   * Reject new backfill starts when the week counter has reached this value.
   * The 50-call gap below `perWeek` reserves headroom for in-flight workers,
   * webhook-triggered token refreshes, and on-demand syncs to finish without
   * tripping the hard cap.
   */
  weeklyStartRejectAt: 150,
} as const;

/** Result of calling `acquireSuuntoApiCall`. */
export type SuuntoQuotaResult =
  | { allowed: true; minuteCount: number; weekCount: number; redisAvailable: boolean }
  | { allowed: false; retryAfter: number; minuteCount: number; weekCount: number; redisAvailable: true };

function buildSuuntoMinuteKey(): string {
  // Minute bucket — Math.floor(Date.now() / 60_000) gives an integer that
  // changes every 60 seconds. Window naturally rolls over without explicit
  // expiry coordination; expiry is just garbage collection.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  return `rl:suunto:quota:minute:${minuteBucket}`;
}

function buildSuuntoWeekKey(): string {
  // ISO-week bucket — ISO weeks start Monday 00:00 UTC. Using
  // floor(Date.now() / weekMs) gives a stable integer for the current week
  // since 1970-01-05 (the first Monday of the Unix epoch's week-aligned
  // calendar). Equivalent calendars across all callers, no library needed.
  const ISO_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weekBucket = Math.floor((Date.now() - 4 * 24 * 60 * 60 * 1000) / ISO_WEEK_MS);
  return `rl:suunto:quota:week:${weekBucket}`;
}

/**
 * Increment the per-minute and weekly Suunto API call counters atomically,
 * returning whether the call is allowed under both caps.
 *
 * Behavior:
 * - If Redis is unavailable, allows the call (graceful degradation — same
 *   policy as the other rate-limit helpers in this file). Logs a warning so
 *   we notice if the system runs uncapped for long.
 * - If the per-minute cap is hit, returns `allowed: false` with `retryAfter`
 *   (seconds until the minute bucket rolls). Caller must NOT make the API
 *   call. The minute counter is rolled back so we don't double-count.
 * - The weekly counter is incremented unconditionally on every call attempt
 *   (including denied ones) to be conservative — a denied call doesn't hit
 *   Suunto's API but the next in-flight retry might.
 *
 * Always include the surrounding `try/finally` semantics around the actual
 * fetch so a thrown exception doesn't leave the counters wrong.
 */
export async function acquireSuuntoApiCall(): Promise<SuuntoQuotaResult> {
  if (!isRedisReady()) {
    console.warn('[SuuntoQuota] Redis unavailable, allowing Suunto API call without throttling');
    return { allowed: true, minuteCount: 0, weekCount: 0, redisAvailable: false };
  }

  try {
    const redis = getRedisConnection();
    const minuteKey = buildSuuntoMinuteKey();
    const weekKey = buildSuuntoWeekKey();

    const minuteCount = await redis.incr(minuteKey);
    if (minuteCount === 1) {
      // First hit in this bucket — set TTL slightly longer than the bucket
      // window so a slow rollover doesn't leave the key dangling forever.
      await redis.expire(minuteKey, 90);
    }

    const weekCount = await redis.incr(weekKey);
    if (weekCount === 1) {
      // 8 days TTL — slightly longer than a week to avoid early eviction
      // around the bucket boundary.
      await redis.expire(weekKey, 8 * 24 * 60 * 60);
    }

    if (minuteCount > SUUNTO_QUOTA.perMinute) {
      // Roll back the minute counter so we don't double-deny the next caller
      // who would have been allowed if not for our overflow attempt.
      await redis.decr(minuteKey);
      const ttl = await redis.ttl(minuteKey);
      console.warn(
        `[SuuntoQuota] Per-minute cap hit (count=${minuteCount}, week=${weekCount}). retryAfter=${ttl}s`
      );
      return {
        allowed: false,
        retryAfter: ttl > 0 ? ttl : 60,
        minuteCount: minuteCount - 1,
        weekCount,
        redisAvailable: true,
      };
    }

    // Observability log for SUUNTO_TODO item 11 mitigation 4. Two tiers so
    // we don't pollute info-level logs at steady-state traffic:
    //   - debug: every allowed call (full audit trail when explicitly enabled)
    //   - info: only when usage crosses 70% of either cap (the actually
    //     interesting moments — approaching the throttle or weekly limit)
    // At full per-minute throttle (10/min sustained) this still keeps info
    // volume bounded to ~3 lines/minute (calls 8, 9, 10 per minute) instead
    // of 10, and tells ops at a glance when we're hot.
    const minuteWarnAt = Math.ceil(SUUNTO_QUOTA.perMinute * 0.7);
    const weekWarnAt = Math.ceil(SUUNTO_QUOTA.perWeek * 0.7);
    const elevated = minuteCount >= minuteWarnAt || weekCount >= weekWarnAt;
    const message = `[SuuntoQuota] call allowed minute=${minuteCount}/${SUUNTO_QUOTA.perMinute} week=${weekCount}/${SUUNTO_QUOTA.perWeek}`;
    if (elevated) {
      console.info(message);
    } else {
      console.debug(message);
    }

    return { allowed: true, minuteCount, weekCount, redisAvailable: true };
  } catch (err) {
    console.warn(
      '[SuuntoQuota] Redis error, allowing Suunto API call without throttling:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { allowed: true, minuteCount: 0, weekCount: 0, redisAvailable: false };
  }
}

/**
 * Read the current week's Suunto API call count without incrementing it.
 * Used by backfill route and batch route as a pre-flight gate — if the
 * counter is already at `weeklyStartRejectAt`, we refuse to start a new
 * backfill rather than queueing work that would 429 mid-flight.
 *
 * Returns 0 if Redis is unavailable so we don't block backfills on infra
 * outages.
 */
export async function getSuuntoWeekCount(): Promise<number> {
  if (!isRedisReady()) return 0;
  try {
    const redis = getRedisConnection();
    const value = await redis.get(buildSuuntoWeekKey());
    return value ? parseInt(value, 10) : 0;
  } catch {
    return 0;
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
