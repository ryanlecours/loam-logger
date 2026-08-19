import type Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { getRedisConnection, isRedisReady } from './redis';
import { createLogger } from './logger';
import type { SyncProvider } from './queue';

// Module-scoped child logger for the Suunto outbound-quota helpers below.
// The legacy rate-limit functions in this file still use console.* for
// historical reasons; new code (acquireSuuntoApiCall, getSuuntoWeekCount)
// goes through pino so the logs flow into the structured pipeline with
// timestamps, levels, and the `suunto-quota` service tag.
const quotaLog = createLogger('suunto-quota');

// Rejection logging for the limiters below. Structured, so a rejection is
// queryable in the JSON log stream rather than being a bare console line.
const limitLog = createLogger('rate-limit');

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
  /** requestRideTrack: max 10 stream fetches per hour per user (each costs a Strava API read) */
  requestRideTrack: { windowSeconds: 3600, maxRequests: 10 },
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
  /** setComponentRideAdjustment: max 60/min — users toggle several rows in
   *  quick succession in the component-rides modal; each call is a bounded
   *  upsert + recompute */
  setComponentRideAdjustment: { windowSeconds: 60, maxRequests: 60 },
  /** clearComponentRideAdjustment: max 60/min (same modal interaction) */
  clearComponentRideAdjustment: { windowSeconds: 60, maxRequests: 60 },
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
  /** oauthStart: max 10 requests per 10 minutes per user (creates DB row each
   *  call). The budget is per user, not per provider, and mobile onboarding
   *  offers four connect buttons — at 5, a user connecting all four had a
   *  single retry left before a 10-minute lockout. */
  oauthStart: { windowSeconds: 600, maxRequests: 10 },
  /** updateUserPreferences: max 20 requests per minute per user */
  updateUserPreferences: { windowSeconds: 60, maxRequests: 20 },
  /** unregisterPushToken: max 20 requests per minute per user (one call per
   *  logout; matches updateUserPreferences since it's a peer of that path) */
  unregisterPushToken: { windowSeconds: 60, maxRequests: 20 },
  /** updateAnalyticsOptOut: max 10 toggles per hour per user. Users rarely flip
   *  this — a tight cap bounds cache-invalidation abuse without impacting
   *  legitimate usage. */
  updateAnalyticsOptOut: { windowSeconds: 3600, maxRequests: 10 },
  /** updateBikeNotificationPreference: max 20 requests per minute per user */
  updateBikeNotificationPreference: { windowSeconds: 60, maxRequests: 20 },
  /** markTrailStewardshipNoticeSeen: max 20 requests per minute per user
   *  (one-shot "dismiss notice" write; cap just bounds abuse) */
  markTrailStewardshipNoticeSeen: { windowSeconds: 60, maxRequests: 20 },
  /** backfillWeatherForMyRides: max 3 requests per 5 minutes. Each call
   *  enqueues up to BATCH_LIMIT (500) jobs against Open-Meteo, so the limit
   *  exists to stop a runaway client loop while still allowing legitimate
   *  "Fetch more" clicks to drain a large history over a few batches. */
  backfillWeatherForMyRides: { windowSeconds: 300, maxRequests: 3 },
  /** backfillGarminWeather: max 3 requests per 5 minutes. Each call enqueues a
   *  single throttled per-user job that fires Garmin backfill requests, so the
   *  limit just stops a client loop from re-queuing needlessly. */
  backfillGarminWeather: { windowSeconds: 300, maxRequests: 3 },
} as const;

/**
 * Rate limit configuration for polling queries.
 * Uses a sliding window approach with max requests per window.
 */
export const QUERY_RATE_LIMITS = {
  /** unassignedRides: max 60 requests per minute per user (supports ~1 req/sec polling) */
  unassignedRides: { windowSeconds: 60, maxRequests: 60 },
  /** unassignedRideCount: max 60 requests per minute per user. Not polled today
   *  (dashboard mount, tab focus and pull-to-refresh), so this is headroom
   *  rather than a constraint — it exists because the query is a COUNT over a
   *  rider's whole Ride table and its sibling unassignedRides is limited the
   *  same way. A client that starts polling it inherits the protection. */
  unassignedRideCount: { windowSeconds: 60, maxRequests: 60 },
  /** importNotificationState: max 30 requests per minute per user (supports 30s polling) */
  importNotificationState: { windowSeconds: 60, maxRequests: 30 },
  /** rideTrack: max 60 requests per minute per user (map open + post-request polling) */
  rideTrack: { windowSeconds: 60, maxRequests: 60 },
  /** componentRides: max 60 requests per minute per user (modal open +
   *  pagination + post-adjustment refetches all hit it; each call is a few
   *  bounded findMany/aggregate queries) */
  componentRides: { windowSeconds: 60, maxRequests: 60 },
  /** advisorSummary: max 20 LLM calls per 5 minutes per user. Checked only
   *  on cache MISS in the resolver, not on cache-hit refreshes, so the
   *  limit bounds Anthropic dollar cost directly (~$0.96/hour worst case
   *  at Haiku 4.5 rates) without punishing users who just re-open the
   *  bike-detail screen. Legitimate cadence rarely produces more than
   *  a few misses in a 5-min window (each miss requires a mutation to
   *  bust the cache; someone triggering 20+ mutations in 5 minutes is
   *  abusive or scripted). */
  advisorSummary: { windowSeconds: 300, maxRequests: 20 },
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
): CountedRateLimitResult {
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
    return { result: { allowed: true, redisAvailable: false }, count: 1 };
  }

  // Increment counter
  entry.count++;

  if (entry.count <= maxRequests) {
    return { result: { allowed: true, redisAvailable: false }, count: entry.count };
  }

  // Rate limited
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  return {
    result: {
      allowed: false,
      retryAfter: retryAfter > 0 ? retryAfter : windowSeconds,
      redisAvailable: false,
    },
    count: entry.count,
  };
}

/**
 * Lua: increment a window counter and guarantee it carries an expiry.
 *
 * Replaces the old `INCR` then `if (count === 1) EXPIRE` pair, which was two
 * round trips and not atomic. If anything interrupted the gap between them (a
 * container restart mid-request, an ioredis reconnect, an EXPIRE that errored
 * into the caller's catch block), the key survived with no TTL. A counter with
 * no TTL never resets, so once it passed the cap the user was rate limited on
 * that operation forever, and `TTL` returning -1 made every rejection report
 * the full window as `retryAfter`. That is exactly how NODE-7 stranded one
 * rider's updateUserPreferences for four months.
 *
 * The `ttl < 0` branch is the self-heal: it re-arms the expiry on any key that
 * already lost one, so existing orphans age out on their next hit instead of
 * needing a manual DEL.
 *
 * Returns [count, ttl]; ttl is always positive on return.
 */
const INCR_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  local ttl = redis.call('TTL', KEYS[1])
  if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
  end
  return {count, ttl}
`;

/** ioredis attaches the script as a method on the connection. */
type CounterRedis = Redis & {
  incrWithTtl(key: string, windowSeconds: string): Promise<[number, number]>;
};

/**
 * Connections the script has already been registered on. A WeakSet rather than
 * a flag because the singleton is rebuilt if the connection is torn down, and
 * because tests hand back a fresh mock per case.
 */
const scriptedConnections = new WeakSet<object>();

/**
 * Get the Redis connection with `incrWithTtl` registered.
 *
 * `defineCommand` rather than a bare `eval`: ioredis registers the body once
 * and calls it by hash thereafter, so this hot path (every rate-limited
 * mutation and query) doesn't re-send the script on every request. It falls
 * back to EVAL by itself when Redis answers NOSCRIPT, which is what happens
 * after a restart flushes the script cache.
 */
function getCounterRedis(): CounterRedis {
  const redis = getRedisConnection();
  if (!scriptedConnections.has(redis)) {
    redis.defineCommand('incrWithTtl', { numberOfKeys: 1, lua: INCR_WITH_TTL });
    scriptedConnections.add(redis);
  }
  return redis as CounterRedis;
}

/**
 * Increment a fixed-window counter, arming (or repairing) its expiry in the
 * same atomic call.
 *
 * @param key - The Redis counter key
 * @param windowSeconds - Window length, used as the key's TTL
 * @returns The post-increment count and the key's remaining TTL in seconds
 */
async function incrementWindowCounter(
  key: string,
  windowSeconds: number
): Promise<{ count: number; ttl: number }> {
  const [count, ttl] = await getCounterRedis().incrWithTtl(key, String(windowSeconds));
  return { count, ttl };
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
  /** Lift analysis cooldown: 5 seconds per target ride (prevents duplicate enqueue spam) */
  liftAnalyze: 5 * SECONDS,
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
  /** shared-history: max 30 requests per minute per IP (public bike-share pages; prevents scripted scraping of known slugs — slug entropy already defeats brute-force enumeration) */
  'shared-history': { windowSeconds: 60, maxRequests: 30 },
  /** token-refresh: max 10 per minute per USER (not IP: carrier-grade NAT
   *  puts many riders behind one IP, and the uid is already
   *  signature-verified by the time this runs, so junk floods never get
   *  here). Legitimate cadence is ~4/hour/device; 10/min absorbs races and
   *  retries while capping the DB writes each refresh performs. */
  'token-refresh': { windowSeconds: 60, maxRequests: 10 },
  /** token-logout: max 10 per minute per USER (same keying rationale as
   *  token-refresh; each call is one conditional DB write) */
  'token-logout': { windowSeconds: 60, maxRequests: 10 },
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
 * An in-memory limiter result with its post-increment counter alongside.
 * Internal, and deliberately not folded into RateLimitResult: it lets
 * checkAuthRateLimit tell the first rejection of a window from the hundred
 * that follow it, so an abuse report fires once per window per identifier
 * instead of once per request, without widening what every caller receives.
 */
type CountedRateLimitResult = { result: RateLimitResult; count: number };

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
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds).result;
  }

  try {
    // Counter and expiry move together: see incrementWindowCounter for why a
    // key that loses its TTL strands the caller permanently.
    const { count, ttl } = await incrementWindowCounter(key, config.windowSeconds);

    if (count <= config.maxRequests) {
      return { allowed: true, redisAvailable: true };
    }

    // Rejections no longer open a Sentry issue (they are the limiter working),
    // so this log is the trace that a caller was throttled.
    limitLog.warn(
      { kind: 'mutation', operation, count, retryAfter: ttl > 0 ? ttl : config.windowSeconds },
      'Mutation rate limit rejected a call'
    );
    // Rate limited - report the remaining window for retry info
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
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds).result;
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
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds).result;
  }

  try {
    // Counter and expiry move together: see incrementWindowCounter for why a
    // key that loses its TTL strands the caller permanently.
    const { count, ttl } = await incrementWindowCounter(key, config.windowSeconds);

    if (count <= config.maxRequests) {
      return { allowed: true, redisAvailable: true };
    }

    // Rejections no longer open a Sentry issue (they are the limiter working),
    // so this log is the trace that a caller was throttled.
    limitLog.warn(
      { kind: 'query', operation, count, retryAfter: ttl > 0 ? ttl : config.windowSeconds },
      'Query rate limit rejected a call'
    );
    // Rate limited - report the remaining window for retry info
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
    return checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds).result;
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
 * Log an auth-limiter rejection, and raise it to Sentry on the first rejection
 * of the window.
 *
 * The auth limiter guards signup, forgot/reset-password, OAuth login and token
 * refresh, so a run of rejections is not a client bug like it is on the other
 * limiters: it is someone brute-forcing. Eight of its ten call sites answer
 * with a plain 429 from an Express route rather than a thrown GraphQLError, so
 * these rejections never reached Sentry even before RATE_LIMITED was filtered
 * out of the Apollo plugin, and stdout logs carry no alerting. This closes that
 * gap.
 *
 * `count === maxRequests + 1` is the first request past the cap, so a
 * credential-stuffing run raises one Sentry event per identifier per window
 * however many thousands of requests it fires. Sentry alert rules can key on
 * `ratelimit.operation`.
 *
 * The identifier (a client IP for the public routes, a user id for the token
 * ones) rides in the Sentry event, not in the log line: the pino config redacts
 * IPs from stdout as PII, and this keeps that policy intact while still naming
 * the source somewhere the on-call can act on it.
 */
/** Report a rejection coming out of the in-memory fallback, then pass it on. */
function reportIfAuthRejected(
  operation: AuthRateLimitType,
  identifier: string,
  fallback: CountedRateLimitResult
): RateLimitResult {
  const { result, count } = fallback;
  if (!result.allowed) {
    reportAuthLimitTrip(operation, identifier, count, result.retryAfter);
  }
  return result;
}

function reportAuthLimitTrip(
  operation: AuthRateLimitType,
  identifier: string,
  count: number,
  retryAfter: number
): void {
  const config = AUTH_RATE_LIMITS[operation];
  limitLog.warn(
    { kind: 'auth', operation, count, retryAfter },
    'Auth rate limit rejected a call'
  );

  if (count !== config.maxRequests + 1) return;
  Sentry.captureMessage(`Auth rate limit tripped: ${operation}`, {
    level: 'warning',
    tags: { 'ratelimit.operation': operation },
    extra: {
      operation,
      identifier,
      count,
      maxRequests: config.maxRequests,
      windowSeconds: config.windowSeconds,
    },
  });
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

  // Fallback to in-memory rate limiting if Redis is unavailable. A Redis
  // outage must not silence the abuse signal, so the fallback reports too.
  if (!isRedisReady()) {
    return reportIfAuthRejected(
      operation,
      identifier,
      checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds)
    );
  }

  try {
    // Counter and expiry move together: see incrementWindowCounter for why a
    // key that loses its TTL strands the caller permanently.
    const { count, ttl } = await incrementWindowCounter(key, config.windowSeconds);

    if (count <= config.maxRequests) {
      return { allowed: true, redisAvailable: true };
    }

    reportAuthLimitTrip(operation, identifier, count, ttl > 0 ? ttl : config.windowSeconds);
    // Rate limited - report the remaining window for retry info
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
    return reportIfAuthRejected(
      operation,
      identifier,
      checkMemoryRateLimit(key, config.maxRequests, config.windowSeconds)
    );
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
 *   call. BOTH counters are rolled back via DECR — a denied call doesn't
 *   actually hit Suunto's API, so neither the per-minute window nor the
 *   weekly budget should be charged for it. Counting denied calls against
 *   the weekly cap would make the `weeklyStartRejectAt` gate trip earlier
 *   than necessary (e.g., a 20-call burst that all 429 would burn 20
 *   slots out of the 200/week budget without making a single real call).
 *
 * The counters track API calls we ACTUALLY made, not call attempts. Caller
 * is responsible for executing the fetch when allowed; if the fetch itself
 * throws after acquiring a slot, that slot is lost (acceptable — fetch
 * errors are a separate failure mode and very rare in practice).
 */
export async function acquireSuuntoApiCall(): Promise<SuuntoQuotaResult> {
  if (!isRedisReady()) {
    quotaLog.warn('Redis unavailable, allowing Suunto API call without throttling');
    return { allowed: true, minuteCount: 0, weekCount: 0, redisAvailable: false };
  }

  try {
    const redis = getRedisConnection();
    const minuteKey = buildSuuntoMinuteKey();
    const weekKey = buildSuuntoWeekKey();

    // TTL slightly longer than each bucket window so a slow rollover doesn't
    // leave the key dangling: 90s for the minute bucket, 8 days for the week.
    // Both go through incrementWindowCounter so the expiry can never be lost
    // between the INCR and the EXPIRE. A weekly counter stuck without a TTL
    // would exhaust that week's Suunto budget and never recover.
    const { count: minuteCount, ttl: minuteTtl } = await incrementWindowCounter(minuteKey, 90);
    const { count: weekCount } = await incrementWindowCounter(weekKey, 8 * 24 * 60 * 60);

    if (minuteCount > SUUNTO_QUOTA.perMinute) {
      // Roll back BOTH counters: the call is being denied so it never hits
      // Suunto's API and shouldn't count against either budget. Without
      // the week DECR, a burst of 429'd requests (e.g., 20 retries during
      // a hot moment) would burn 20 of the 200/week slots and trip the
      // weeklyStartRejectAt gate earlier than necessary.
      await redis.decr(minuteKey);
      await redis.decr(weekKey);
      const retryAfter = minuteTtl > 0 ? minuteTtl : 60;
      quotaLog.warn(
        { minuteCount, weekCount, retryAfter },
        'Per-minute cap hit'
      );
      return {
        allowed: false,
        retryAfter,
        minuteCount: minuteCount - 1,
        weekCount: weekCount - 1,
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
    const fields = {
      minuteCount,
      perMinute: SUUNTO_QUOTA.perMinute,
      weekCount,
      perWeek: SUUNTO_QUOTA.perWeek,
    };
    if (elevated) {
      quotaLog.info(fields, 'call allowed (elevated)');
    } else {
      quotaLog.debug(fields, 'call allowed');
    }

    return { allowed: true, minuteCount, weekCount, redisAvailable: true };
  } catch (err) {
    quotaLog.warn(
      { err: err instanceof Error ? err.message : 'Unknown error' },
      'Redis error, allowing Suunto API call without throttling'
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
