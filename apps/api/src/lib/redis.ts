import Redis from 'ioredis';

let redis: Redis | null = null;
let consecutiveErrors = 0;
let lastErrorTime: number | null = null;
let isHealthy = false;

const MAX_CONSECUTIVE_ERRORS = 10;
const ERROR_WINDOW_MS = 60_000; // Reset error count if no errors for 1 minute

/**
 * Get the Redis connection singleton.
 * Creates a new connection if one doesn't exist.
 *
 * ioredis has built-in reconnection with exponential backoff.
 * We track consecutive errors to detect persistent connection issues.
 */
export function getRedisConnection(): Redis {
  if (!redis) {
    const REDIS_URL = process.env.REDIS_URL;
    if (!REDIS_URL) {
      throw new Error('REDIS_URL environment variable is required');
    }

    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => {
        // Exponential backoff: 100ms, 200ms, 400ms... max 30s
        const delay = Math.min(Math.pow(2, times) * 100, 30000);
        console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      reconnectOnError: (err) => {
        // Reconnect on specific recoverable errors
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    redis.on('error', (err) => {
      const now = Date.now();

      // Reset error count if we've been stable for a while
      if (lastErrorTime && now - lastErrorTime > ERROR_WINDOW_MS) {
        consecutiveErrors = 0;
      }

      consecutiveErrors++;
      lastErrorTime = now;
      isHealthy = false;

      // Log at different levels based on severity
      if (consecutiveErrors === 1) {
        console.warn(`[Redis] Connection error:`, err.message);
      } else if (consecutiveErrors % 5 === 0) {
        // Log every 5th error to avoid flooding
        console.error(
          `[Redis] Persistent connection issues (${consecutiveErrors} errors):`,
          err.message
        );
      }

      if (
        consecutiveErrors >= MAX_CONSECUTIVE_ERRORS &&
        consecutiveErrors % MAX_CONSECUTIVE_ERRORS === 0
      ) {
        console.error(
          `[Redis] CRITICAL: ${consecutiveErrors} consecutive errors. ` +
            `Redis-dependent features (rate limiting, job queues) may be unavailable. ` +
            `Check Redis connectivity and REDIS_URL configuration.`
        );
      }
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    redis.on('ready', () => {
      consecutiveErrors = 0;
      lastErrorTime = null;
      isHealthy = true;
      console.log('[Redis] Ready to accept commands');
    });

    redis.on('close', () => {
      isHealthy = false;
      console.log('[Redis] Connection closed');
    });

    redis.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });
  }
  return redis;
}

/**
 * Check if Redis is connected and ready.
 * This is a quick check based on connection state.
 */
export function isRedisReady(): boolean {
  return redis?.status === 'ready' && isHealthy;
}

/**
 * Perform a health check by pinging Redis.
 * Returns detailed health status for monitoring endpoints.
 */
export async function checkRedisHealth(): Promise<{
  healthy: boolean;
  status: string;
  latencyMs?: number;
  consecutiveErrors: number;
  lastError?: string;
}> {
  if (!redis) {
    return {
      healthy: false,
      status: 'not_initialized',
      consecutiveErrors,
    };
  }

  const startTime = Date.now();
  try {
    await redis.ping();
    const latencyMs = Date.now() - startTime;

    return {
      healthy: true,
      status: redis.status,
      latencyMs,
      consecutiveErrors: 0,
    };
  } catch (err) {
    return {
      healthy: false,
      status: redis.status,
      latencyMs: Date.now() - startTime,
      consecutiveErrors,
      lastError: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Execute a Redis operation with graceful degradation.
 * If Redis is unavailable, returns the fallback value instead of throwing.
 *
 * Use this for non-critical operations where availability > consistency.
 *
 * @param operation - The Redis operation to execute
 * @param fallback - Value to return if Redis is unavailable
 * @param operationName - Name for logging purposes
 */
export async function withRedisFallback<T>(
  operation: () => Promise<T>,
  fallback: T,
  operationName: string
): Promise<{ value: T; fromFallback: boolean }> {
  // Quick check before attempting operation
  if (!isRedisReady()) {
    console.warn(`[Redis] ${operationName}: Redis not ready, using fallback`);
    return { value: fallback, fromFallback: true };
  }

  try {
    const value = await operation();
    return { value, fromFallback: false };
  } catch (err) {
    console.warn(
      `[Redis] ${operationName} failed, using fallback:`,
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { value: fallback, fromFallback: true };
  }
}

/**
 * Close the Redis connection.
 * Should be called during graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    isHealthy = false;
    await redis.quit();
    redis = null;
    console.log('[Redis] Connection closed');
  }
}
