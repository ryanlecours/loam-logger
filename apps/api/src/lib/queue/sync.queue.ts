import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

export type SyncProvider = 'strava' | 'garmin' | 'suunto';

export type SyncJobName =
  | 'syncLatest'
  | 'syncActivity';

export type SyncJobData = {
  userId: string;
  provider: SyncProvider;
  activityId?: string; // For syncActivity jobs
};

let syncQueue: Queue<SyncJobData, void, SyncJobName> | null = null;

/**
 * Get or create the sync queue singleton.
 * Used for high-priority provider sync jobs (webhook-triggered, login-triggered).
 */
export function getSyncQueue(): Queue<SyncJobData, void, SyncJobName> {
  if (!syncQueue) {
    syncQueue = new Queue<SyncJobData, void, SyncJobName>('sync', {
      ...getQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        priority: 1, // High priority
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return syncQueue;
}

/**
 * Close the sync queue connection.
 */
export async function closeSyncQueue(): Promise<void> {
  if (syncQueue) {
    await syncQueue.close();
    syncQueue = null;
  }
}
