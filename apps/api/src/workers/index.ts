import { createEmailWorker, closeEmailWorker } from './email.worker';
import { createSyncWorker, closeSyncWorker } from './sync.worker';
import { closeRedisConnection } from '../lib/redis';
import { closeEmailQueue, closeSyncQueue, closeBackfillQueue } from '../lib/queue';

/**
 * Start all BullMQ workers.
 * Workers will process jobs from their respective queues.
 */
export function startWorkers(): void {
  console.log('[Workers] Starting BullMQ workers...');

  createEmailWorker();
  createSyncWorker();
  // Future: createBackfillWorker();

  console.log('[Workers] All workers started');
}

/**
 * Stop all workers and close queue connections.
 * Should be called during graceful shutdown.
 */
export async function stopWorkers(): Promise<void> {
  console.log('[Workers] Stopping workers...');

  await closeEmailWorker();
  await closeSyncWorker();
  // Future: await closeBackfillWorker();

  // Close queue connections
  await closeEmailQueue();
  await closeSyncQueue();
  await closeBackfillQueue();

  // Close Redis connection
  await closeRedisConnection();

  console.log('[Workers] All workers stopped');
}
