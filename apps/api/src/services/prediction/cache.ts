import type { Redis } from 'ioredis';
import { getRedisConnection, isRedisReady } from '../../lib/redis';
import type { PredictionCacheKey, BikePredictionSummary } from './types';
import { DEFAULT_CACHE_TTL_SECONDS, ALGO_VERSION } from './config';

/**
 * Delete Redis keys matching a pattern using SCAN (non-blocking).
 * Unlike KEYS, SCAN doesn't block the Redis server.
 */
async function deleteKeysByPattern(
  redis: Redis,
  pattern: string
): Promise<void> {
  let cursor = '0';
  do {
    const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = newCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}

/** In-memory cache fallback with LRU tracking via lastAccessed */
const memoryCache = new Map<
  string,
  { value: BikePredictionSummary; expiresAt: number; lastAccessed: number }
>();

/** Maximum entries in memory cache */
const MEMORY_CACHE_MAX_SIZE = 100;

/**
 * Evict entries from memory cache when full.
 * Strategy: First evict expired entries, then evict least recently used.
 */
function evictFromMemoryCache(): void {
  const now = Date.now();

  // First pass: remove any expired entries
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }

  // If still at capacity, evict least recently used
  if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of memoryCache) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      memoryCache.delete(lruKey);
    }
  }
}

/**
 * Validate cached prediction data structure.
 * Provides runtime protection against corrupted or malicious cache data.
 */
function isValidCachedPrediction(data: unknown): data is BikePredictionSummary {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  return (
    typeof obj.bikeId === 'string' &&
    obj.bikeId.length > 0 &&
    typeof obj.bikeName === 'string' &&
    Array.isArray(obj.components) &&
    ['ALL_GOOD', 'DUE_SOON', 'DUE_NOW', 'OVERDUE'].includes(obj.overallStatus as string) &&
    typeof obj.dueNowCount === 'number' &&
    typeof obj.dueSoonCount === 'number' &&
    typeof obj.algoVersion === 'string'
  );
}

/**
 * Build cache key string from parameters.
 */
export function buildCacheKey(params: PredictionCacheKey): string {
  return `pred:${params.algoVersion}:user:${params.userId}:bike:${params.bikeId}:tier:${params.planTier}:mode:${params.predictionMode}`;
}

/**
 * Get cached prediction if available.
 *
 * @param params - Cache key parameters
 * @returns Cached prediction or null if not found
 */
export async function getCachedPrediction(
  params: PredictionCacheKey
): Promise<BikePredictionSummary | null> {
  const key = buildCacheKey(params);

  // Try Redis first
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      const cached = await redis.get(key);

      if (cached) {
        const parsed = JSON.parse(cached);
        // Validate cache structure to prevent cache poisoning
        if (!isValidCachedPrediction(parsed)) {
          console.warn('[PredictionCache] Invalid cache structure, invalidating');
          await redis.del(key);
          return null;
        }
        // Rehydrate Date
        parsed.generatedAt = new Date(parsed.generatedAt);
        return parsed;
      }
    } catch (error) {
      console.warn('[PredictionCache] Redis read failed:', error);
    }
  }

  // Fallback to memory cache
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expiresAt > Date.now()) {
    // Update last accessed time for LRU tracking
    memCached.lastAccessed = Date.now();
    return memCached.value;
  }

  // Clean up expired entry
  if (memCached) {
    memoryCache.delete(key);
  }

  return null;
}

/**
 * Store prediction in cache.
 *
 * @param params - Cache key parameters
 * @param prediction - Prediction to cache
 * @param ttlSeconds - Time-to-live in seconds (default: 30 minutes)
 */
export async function setCachedPrediction(
  params: PredictionCacheKey,
  prediction: BikePredictionSummary,
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS
): Promise<void> {
  const key = buildCacheKey(params);
  const now = Date.now();
  const expiresAt = now + ttlSeconds * 1000;

  // Evict entries if cache is full (LRU strategy)
  if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE && !memoryCache.has(key)) {
    evictFromMemoryCache();
  }
  memoryCache.set(key, { value: prediction, expiresAt, lastAccessed: now });

  // Store in Redis
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      await redis.setex(key, ttlSeconds, JSON.stringify(prediction));
    } catch (error) {
      console.warn('[PredictionCache] Redis write failed:', error);
    }
  }
}

/**
 * Invalidate prediction cache for a bike.
 * Called when ride data or component data changes.
 *
 * @param userId - User ID
 * @param bikeId - Bike ID
 */
export async function invalidateBikePrediction(
  userId: string,
  bikeId: string
): Promise<void> {
  // Build pattern prefix for this bike's cache keys
  const keyPrefix = `pred:${ALGO_VERSION}:user:${userId}:bike:${bikeId}:`;

  // Clear memory cache
  for (const key of memoryCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      memoryCache.delete(key);
    }
  }

  // Clear Redis cache using SCAN (non-blocking)
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      await deleteKeysByPattern(redis, `${keyPrefix}*`);
    } catch (error) {
      console.warn('[PredictionCache] Redis invalidation failed:', error);
    }
  }
}

/**
 * Invalidate all predictions for a user.
 * Called when user role changes.
 *
 * @param userId - User ID
 */
export async function invalidateUserPredictions(userId: string): Promise<void> {
  const keyPrefix = `pred:${ALGO_VERSION}:user:${userId}:`;

  // Clear memory cache
  for (const key of memoryCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      memoryCache.delete(key);
    }
  }

  // Clear Redis cache using SCAN (non-blocking)
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      await deleteKeysByPattern(redis, `${keyPrefix}*`);
    } catch (error) {
      console.warn('[PredictionCache] Redis user invalidation failed:', error);
    }
  }
}

/**
 * Clear all entries from memory cache (for testing).
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

/**
 * Get memory cache size (for testing/monitoring).
 */
export function getMemoryCacheSize(): number {
  return memoryCache.size;
}
