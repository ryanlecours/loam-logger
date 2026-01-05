import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';
import type { SyncProvider } from './sync.queue';

export type BackfillJobName =
  | 'backfillStart'
  | 'backfillChunk';

export type BackfillJobData = {
  userId: string;
  provider: SyncProvider;
  cursor?: string; // Pagination cursor for chunked backfill
  startDate?: string; // ISO date string
  endDate?: string; // ISO date string
};

let backfillQueue: Queue<BackfillJobData, void, BackfillJobName> | null = null;

/**
 * Get or create the backfill queue singleton.
 * Used for low-priority historical data imports with rate limiting.
 */
export function getBackfillQueue(): Queue<BackfillJobData, void, BackfillJobName> {
  if (!backfillQueue) {
    backfillQueue = new Queue<BackfillJobData, void, BackfillJobName>('backfill', {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        priority: 10, // Lower priority than sync
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    });
  }
  return backfillQueue;
}

/**
 * Close the backfill queue connection.
 */
export async function closeBackfillQueue(): Promise<void> {
  if (backfillQueue) {
    await backfillQueue.close();
    backfillQueue = null;
  }
}
