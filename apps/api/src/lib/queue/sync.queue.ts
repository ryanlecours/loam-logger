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
 * Build a deterministic job ID for sync jobs.
 * Format: syncLatest:<provider>:<userId> or syncActivity:<provider>:<userId>:<activityId>
 */
export function buildSyncJobId(
  jobName: SyncJobName,
  provider: SyncProvider,
  userId: string,
  activityId?: string
): string {
  if (jobName === 'syncActivity' && activityId) {
    return `${jobName}:${provider}:${userId}:${activityId}`;
  }
  return `${jobName}:${provider}:${userId}`;
}

/**
 * Result of enqueueing a sync job.
 */
export type EnqueueSyncResult =
  | { status: 'queued'; jobId: string }
  | { status: 'already_queued'; jobId: string };

/**
 * Enqueue a sync job with deduplication.
 * Uses deterministic job IDs so duplicate jobs are never queued.
 *
 * @param jobName - The job name (syncLatest, syncActivity)
 * @param data - The job data
 * @returns Result indicating if job was queued or already exists
 */
export async function enqueueSyncJob(
  jobName: SyncJobName,
  data: SyncJobData
): Promise<EnqueueSyncResult> {
  const queue = getSyncQueue();
  const jobId = buildSyncJobId(jobName, data.provider, data.userId, data.activityId);

  // Check if job already exists (waiting, delayed, or active)
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    // If job is waiting, delayed, or active, don't enqueue again
    if (state === 'waiting' || state === 'delayed' || state === 'active') {
      console.log(`[SyncQueue] Job ${jobId} already exists (state: ${state})`);
      return { status: 'already_queued', jobId };
    }
    // If job is completed or failed, we can enqueue a new one
  }

  await queue.add(jobName, data, {
    jobId,
  });

  console.log(`[SyncQueue] Enqueued job ${jobId}`);
  return { status: 'queued', jobId };
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
