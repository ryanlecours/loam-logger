import { Queue } from 'bullmq';
import crypto from 'crypto';
import { getQueueConnection } from './connection';

// Time constants in milliseconds
const SECONDS = 1000;

// Sync job retry configuration
const INITIAL_RETRY_DELAY_MS = 2 * SECONDS;
const MAX_RETRY_ATTEMPTS = 5;
const COMPLETED_JOBS_TO_KEEP = 10;
const FAILED_JOBS_TO_KEEP = 50;
const HIGH_PRIORITY = 1;

export type SyncProvider = 'strava' | 'garmin' | 'whoop' | 'suunto';

export type SyncJobName =
  | 'syncLatest'
  | 'syncActivity';

export type SyncJobData = {
  userId: string;
  provider: SyncProvider;
  activityId?: string; // For syncActivity jobs
  /**
   * Garmin only. The callbackURL from the ping that triggered this job.
   *
   * Following it is what makes the resulting request a PROMPTED pull in
   * Garmin's Partner Verification, and what marks the ping answered. Without
   * it the worker has to compose its own request, which fails both checks.
   *
   * Deliberately excluded from the job id (see buildSyncJobId): two pings for
   * the same activity must still dedupe to one job. A pushed activity is
   * discriminated by its contents instead, so an edit is not mistaken for a
   * repeat of the delivery it replaces.
   */
  callbackURL?: string;
  /**
   * Garmin only. The activity itself, when Garmin PUSHed it rather than pinging.
   *
   * Carrying the payload through the queue keeps the heavy work on the worker
   * where every other ingest path already runs, and means the webhook can ACK
   * inside Garmin's 30-second window without doing database work. When this is
   * set the worker makes no outbound request at all, which is the entire point:
   * a delivery we never answer cannot be scored as an unprompted pull.
   *
   * The tradeoff is that the payload lives in Redis until the job runs. A single
   * ride's samples are a few MB at 1Hz, which is fine; the webhook filters to
   * cycling first so a batch of runs never lands here.
   */
  pushedActivity?: unknown;
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
 * Discriminator for a PUSHed activity's contents.
 *
 * Without this, an edit is indistinguishable from the original: same activity,
 * same job id, and BullMQ treats the second one as a duplicate of a job it has
 * already run. A rider who corrects an activity's type in Garmin Connect
 * minutes after it synced would have that correction dropped, which is exactly
 * the case manually-updated notifications exist to deliver.
 *
 * Samples are excluded. They are the bulk of the payload and hashing thousands
 * of points on every delivery costs real time, while every edit worth acting on
 * moves something in the summary: type, duration, distance, name. A trim moves
 * the duration too.
 *
 * The key array passed to JSON.stringify both filters and fixes the ordering,
 * so the hash does not depend on the order Garmin happened to serialize.
 */
function pushedActivityHash(pushedActivity: unknown): string | undefined {
  if (!pushedActivity || typeof pushedActivity !== 'object') return undefined;

  const { samples: _samples, ...rest } = pushedActivity as Record<string, unknown>;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return crypto.createHash('md5').update(canonical ?? '').digest('hex').slice(0, 12);
}

/**
 * Build a deterministic job ID for sync jobs.
 * Format: syncLatest_<provider>_<userId> or syncActivity_<provider>_<userId>_<activityId>
 * Note: BullMQ does not allow colons in job IDs, so we use underscores.
 *
 * A pushed activity appends a content hash, so a re-delivery of identical data
 * still dedupes while an edit gets its own job. Notification-driven jobs pass
 * no hash and keep their previous ids.
 */
export function buildSyncJobId(
  jobName: SyncJobName,
  provider: SyncProvider,
  userId: string,
  activityId?: string,
  contentHash?: string
): string {
  if (jobName === 'syncActivity' && activityId) {
    const base = `${jobName}_${provider}_${userId}_${activityId}`;
    return contentHash ? `${base}_${contentHash}` : base;
  }
  return `${jobName}_${provider}_${userId}`;
}

/**
 * Result of enqueueing a sync job.
 */
export type EnqueueSyncResult =
  | { status: 'queued'; jobId: string }
  | { status: 'already_queued'; jobId: string };

/**
 * Enqueue a sync job with deduplication.
 *
 * The deterministic job id is what prevents duplicates: BullMQ creates nothing
 * when one already exists, in any state including completed. Retained completed
 * jobs therefore keep deduping, which is the property that made an edit look
 * like a repeat of the activity it edits until the id learned to include the
 * payload's contents.
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
  const jobId = buildSyncJobId(
    jobName,
    data.provider,
    data.userId,
    data.activityId,
    pushedActivityHash(data.pushedActivity)
  );

  // BullMQ 5 does NOT throw on a duplicate jobId: `add` silently returns the
  // existing job and creates nothing. The catch below was written against an
  // error the library does not raise, so a dropped job was reported as queued.
  // Checking first is what makes the reported status honest.
  //
  // The check-then-add race is deliberate and benign: if two deliveries slip
  // through together BullMQ still creates only one job, because the id is what
  // enforces that. Only the status either caller reports could be wrong, and
  // nothing branches on it.
  const existing = await queue.getJob(jobId);
  if (existing) {
    console.log(`[SyncQueue] Job ${jobId} already exists (duplicate ignored)`);
    return { status: 'already_queued', jobId };
  }

  try {
    await queue.add(jobName, data, { jobId });

    console.log(`[SyncQueue] Enqueued job ${jobId}`);
    return { status: 'queued', jobId };
  } catch (err) {
    // Retained in case a future BullMQ version starts rejecting duplicates
    // outright rather than absorbing them.
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
