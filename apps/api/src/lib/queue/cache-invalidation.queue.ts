import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

// Job retry configuration
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_ATTEMPTS = 5;
const COMPLETED_JOBS_TO_KEEP = 50;
const FAILED_JOBS_TO_KEEP = 200;

export type CacheInvalidationJobName = 'invalidateBike' | 'invalidateUser';

export type CacheInvalidationJobData =
  | { type: 'invalidateBike'; userId: string; bikeId: string }
  | { type: 'invalidateUser'; userId: string };

let cacheInvalidationQueue: Queue<CacheInvalidationJobData, void, CacheInvalidationJobName> | null = null;

/**
 * Get or create the cache invalidation queue singleton.
 */
export function getCacheInvalidationQueue(): Queue<CacheInvalidationJobData, void, CacheInvalidationJobName> {
  if (!cacheInvalidationQueue) {
    cacheInvalidationQueue = new Queue<CacheInvalidationJobData, void, CacheInvalidationJobName>(
      'cache-invalidation',
      {
        connection: getQueueConnection(),
        defaultJobOptions: {
          attempts: MAX_RETRY_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: INITIAL_RETRY_DELAY_MS,
          },
          removeOnComplete: COMPLETED_JOBS_TO_KEEP,
          removeOnFail: FAILED_JOBS_TO_KEEP,
          // Lower priority than user-facing queues
          priority: 20,
        },
      }
    );
  }
  return cacheInvalidationQueue;
}

/**
 * Build a deterministic job ID for deduplication.
 */
function buildJobId(data: CacheInvalidationJobData): string {
  if (data.type === 'invalidateBike') {
    return `invalidate:bike:${data.userId}:${data.bikeId}`;
  }
  return `invalidate:user:${data.userId}`;
}

/**
 * Enqueue a bike prediction cache invalidation.
 * Uses deterministic job IDs to prevent duplicate invalidations.
 */
export async function enqueueBikeInvalidation(
  userId: string,
  bikeId: string
): Promise<void> {
  const queue = getCacheInvalidationQueue();
  const data: CacheInvalidationJobData = { type: 'invalidateBike', userId, bikeId };
  const jobId = buildJobId(data);

  try {
    await queue.add('invalidateBike', data, { jobId });
  } catch (err) {
    // Ignore duplicate job errors - invalidation is already queued
    if (err instanceof Error && err.message.includes('already exists')) {
      return;
    }
    // Log but don't throw - cache invalidation shouldn't break the main flow
    console.error('[CacheInvalidationQueue] Failed to enqueue bike invalidation:', err);
  }
}

/**
 * Enqueue a user predictions cache invalidation.
 * Uses deterministic job IDs to prevent duplicate invalidations.
 */
export async function enqueueUserInvalidation(userId: string): Promise<void> {
  const queue = getCacheInvalidationQueue();
  const data: CacheInvalidationJobData = { type: 'invalidateUser', userId };
  const jobId = buildJobId(data);

  try {
    await queue.add('invalidateUser', data, { jobId });
  } catch (err) {
    // Ignore duplicate job errors
    if (err instanceof Error && err.message.includes('already exists')) {
      return;
    }
    console.error('[CacheInvalidationQueue] Failed to enqueue user invalidation:', err);
  }
}

/**
 * Close the cache invalidation queue connection.
 */
export async function closeCacheInvalidationQueue(): Promise<void> {
  if (cacheInvalidationQueue) {
    await cacheInvalidationQueue.close();
    cacheInvalidationQueue = null;
  }
}
