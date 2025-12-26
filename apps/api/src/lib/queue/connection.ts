import { getRedisConnection } from '../redis';
import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ connection options using the shared Redis connection.
 */
export function getQueueConnection(): ConnectionOptions {
  return {
    connection: getRedisConnection(),
  };
}
