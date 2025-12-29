import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

// Time constants in milliseconds
const SECONDS = 1000;

// Sync job retry configuration
const INITIAL_RETRY_DELAY_MS = 2 * SECONDS;
const MAX_RETRY_ATTEMPTS = 5;
const COMPLETED_JOBS_TO_KEEP = 100;
const FAILED_JOBS_TO_KEEP = 500;
const HIGH_PRIORITY = 1;

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
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: INITIAL_RETRY_DELAY_MS,
        },
        priority: HIGH_PRIORITY,
        removeOnComplete: COMPLETED_JOBS_TO_KEEP,
        removeOnFail: FAILED_JOBS_TO_KEEP,
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
 * Uses atomic add-if-not-exists pattern:
 * 1. Attempt to add the job with a unique jobId
 * 2. BullMQ throws if job with same ID already exists (waiting/delayed/active)
 * 3. Catch the duplicate error and return 'already_queued'
 *
 * This avoids the TOCTOU race condition of checking then adding.
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

  try {
    // Attempt to add the job atomically
    // BullMQ will reject if a job with this ID already exists and is not completed/failed
    await queue.add(jobName, data, {
      jobId,
      // Setting a specific jobId makes this idempotent - BullMQ rejects duplicates
    });

    console.log(`[SyncQueue] Enqueued job ${jobId}`);
    return { status: 'queued', jobId };
  } catch (err) {
    // Check if this is a duplicate job error
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('Job') && message.includes('already exists')) {
      console.log(`[SyncQueue] Job ${jobId} already exists (duplicate rejected)`);
      return { status: 'already_queued', jobId };
    }

    // Re-throw unexpected errors
    throw err;
  }
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
