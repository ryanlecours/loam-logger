import Redis from 'ioredis';

let redis: Redis | null = null;

/**
 * Get the Redis connection singleton.
 * Creates a new connection if one doesn't exist.
 */
export function getRedisConnection(): Redis {
  if (!redis) {
    const REDIS_URL = process.env.REDIS_URL;
    if (!REDIS_URL) {
      throw new Error('REDIS_URL environment variable is required');
    }

    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });
  }
  return redis;
}

/**
 * Close the Redis connection.
 * Should be called during graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    console.log('[Redis] Connection closed');
  }
}
