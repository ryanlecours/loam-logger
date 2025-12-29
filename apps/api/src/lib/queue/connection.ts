import { getRedisConnection } from '../redis';
import type Redis from 'ioredis';

/**
 * Get the Redis connection for BullMQ queues and workers.
 * BullMQ v5 expects the connection to be passed directly to the `connection` option.
 */
export function getQueueConnection(): Redis {
  return getRedisConnection();
}
