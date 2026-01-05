import { Worker, Job } from 'bullmq';
import { getQueueConnection } from '../lib/queue/connection';
import {
  invalidateBikePrediction,
  invalidateUserPredictions,
} from '../services/prediction/cache';
import type {
  CacheInvalidationJobData,
  CacheInvalidationJobName,
} from '../lib/queue/cache-invalidation.queue';

/**
 * Process cache invalidation jobs.
 * This runs separately from the main request path for reliability.
 */
async function processCacheInvalidationJob(
  job: Job<CacheInvalidationJobData, void, CacheInvalidationJobName>
): Promise<void> {
  const { data } = job;

  switch (data.type) {
    case 'invalidateBike':
      await invalidateBikePrediction(data.userId, data.bikeId);
      break;

    case 'invalidateUser':
      await invalidateUserPredictions(data.userId);
      break;

    default:
      // TypeScript exhaustiveness check
      throw new Error(`Unknown cache invalidation type: ${(data as { type: string }).type}`);
  }
}

let cacheInvalidationWorker: Worker<CacheInvalidationJobData, void, CacheInvalidationJobName> | null = null;

/**
 * Create and start the cache invalidation worker.
 * Uses low concurrency to avoid Redis contention.
 */
export function createCacheInvalidationWorker(): Worker<CacheInvalidationJobData, void, CacheInvalidationJobName> {
  if (cacheInvalidationWorker) {
    return cacheInvalidationWorker;
  }

  cacheInvalidationWorker = new Worker<CacheInvalidationJobData, void, CacheInvalidationJobName>(
    'cache-invalidation',
    processCacheInvalidationJob,
    {
      connection: getQueueConnection(),
      concurrency: 1, // Single user app - sequential processing is sufficient
      // Reduce polling frequency when idle to lower Redis costs
      settings: {
        stalledInterval: 60000, // Check for stalled jobs every 60s (default 30s)
      },
      drainDelay: 5000, // Wait 5s between empty polls (default 0)
    }
  );

  cacheInvalidationWorker.on('completed', (job) => {
    const data = job.data;
    const target = data.type === 'invalidateBike'
      ? `bike:${data.bikeId}`
      : `user:${data.userId}`;
    console.log(`[CacheInvalidationWorker] Job ${job.id} completed - ${target}`);
  });

  cacheInvalidationWorker.on('failed', (job, err) => {
    console.error(
      `[CacheInvalidationWorker] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
      err.message
    );
  });

  cacheInvalidationWorker.on('error', (err) => {
    console.error('[CacheInvalidationWorker] Worker error:', err.message);
  });

  console.log('[CacheInvalidationWorker] Started');
  return cacheInvalidationWorker;
}

/**
 * Stop and close the cache invalidation worker.
 */
export async function closeCacheInvalidationWorker(): Promise<void> {
  if (cacheInvalidationWorker) {
    await cacheInvalidationWorker.close();
    cacheInvalidationWorker = null;
    console.log('[CacheInvalidationWorker] Stopped');
  }
}
