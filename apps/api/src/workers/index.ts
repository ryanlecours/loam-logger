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

const SHUTDOWN_TIMEOUT_MS = 10000; // 10 seconds max for shutdown

/**
 * Stop all workers and close queue connections.
 * Uses Promise.allSettled to ensure all cleanup attempts are made even if some fail.
 * Includes a timeout to prevent hanging during shutdown.
 */
export async function stopWorkers(): Promise<void> {
  console.log('[Workers] Stopping workers...');

  const shutdownPromise = async () => {
    // First, close workers (stop processing new jobs)
    const workerResults = await Promise.allSettled([
      closeEmailWorker(),
      closeSyncWorker(),
      // Future: closeBackfillWorker(),
    ]);

    // Log any worker shutdown failures
    workerResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const workerNames = ['EmailWorker', 'SyncWorker'];
        console.error(`[Workers] Failed to close ${workerNames[index]}:`, result.reason);
      }
    });

    // Then, close queue connections
    const queueResults = await Promise.allSettled([
      closeEmailQueue(),
      closeSyncQueue(),
      closeBackfillQueue(),
    ]);

    // Log any queue shutdown failures
    queueResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const queueNames = ['EmailQueue', 'SyncQueue', 'BackfillQueue'];
        console.error(`[Workers] Failed to close ${queueNames[index]}:`, result.reason);
      }
    });

    // Finally, close Redis connection
    try {
      await closeRedisConnection();
    } catch (err) {
      console.error('[Workers] Failed to close Redis connection:', err);
    }
  };

  // Race between shutdown and timeout
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT_MS);
  });

  try {
    await Promise.race([shutdownPromise(), timeoutPromise]);
    console.log('[Workers] All workers stopped');
  } catch (err) {
    if (err instanceof Error && err.message === 'Shutdown timeout') {
      console.error(`[Workers] Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms - forcing exit`);
    } else {
      console.error('[Workers] Shutdown error:', err);
    }
  }
}
