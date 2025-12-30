import { getRedisConnection, isRedisReady } from '../../lib/redis';
import type { PredictionCacheKey, BikePredictionSummary } from './types';
import { DEFAULT_CACHE_TTL_SECONDS, ALGO_VERSION } from './config';

/** In-memory cache fallback */
const memoryCache = new Map<
  string,
  { value: BikePredictionSummary; expiresAt: number }
>();

/** Maximum entries in memory cache */
const MEMORY_CACHE_MAX_SIZE = 100;

/**
 * Build cache key string from parameters.
 */
export function buildCacheKey(params: PredictionCacheKey): string {
  return `pred:${params.algoVersion}:user:${params.userId}:bike:${params.bikeId}:tier:${params.planTier}`;
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
        const parsed = JSON.parse(cached) as BikePredictionSummary;
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
  const expiresAt = Date.now() + ttlSeconds * 1000;

  // Store in memory cache (with size limit)
  if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
    // Remove oldest entry (first key)
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value: prediction, expiresAt });

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

  // Clear Redis cache
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      const pattern = `${keyPrefix}*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
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

  // Clear Redis cache
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      const pattern = `${keyPrefix}*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
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
