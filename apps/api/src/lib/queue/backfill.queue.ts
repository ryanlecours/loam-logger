import { Queue } from 'bullmq';
import crypto from 'crypto';
import { getQueueConnection } from './connection';
import { logger } from '../logger';

// Time constants in milliseconds
const SECONDS = 1000;
const MINUTES = 60 * SECONDS;

// Backfill job retry configuration
const INITIAL_RETRY_DELAY_MS = 1 * MINUTES;
const MAX_RETRY_ATTEMPTS = 3;
const COMPLETED_JOBS_TO_KEEP = 50;
const FAILED_JOBS_TO_KEEP = 100;
const LOW_PRIORITY = 10; // Lower priority than sync jobs (which are 1)

export type BackfillProvider = 'garmin';

export type BackfillJobName = 'backfillYear' | 'processCallback';

export type BackfillJobData = {
  userId: string;
  provider: BackfillProvider;
  year?: string; // For backfillYear: "ytd", "2025", "2024", etc.
  callbackURL?: string; // For processCallback: Garmin callback URL
};

let backfillQueue: Queue<BackfillJobData, void, BackfillJobName> | null = null;

/**
 * Get or create the backfill queue singleton.
 * Used for background processing of historical activity imports.
 */
export function getBackfillQueue(): Queue<BackfillJobData, void, BackfillJobName> {
  if (!backfillQueue) {
    backfillQueue = new Queue<BackfillJobData, void, BackfillJobName>('backfill', {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: INITIAL_RETRY_DELAY_MS,
        },
        priority: LOW_PRIORITY,
        removeOnComplete: COMPLETED_JOBS_TO_KEEP,
        removeOnFail: FAILED_JOBS_TO_KEEP,
      },
    });
  }
  return backfillQueue;
}

/**
 * Build a deterministic job ID for backfill jobs.
 * Format: backfillYear_<provider>_<userId>_<year>
 */
export function buildBackfillJobId(
  provider: BackfillProvider,
  userId: string,
  year: string
): string {
  return `backfillYear_${provider}_${userId}_${year}`;
}

/**
 * Result of enqueueing a backfill job.
 */
export type EnqueueBackfillResult =
  | { status: 'queued'; jobId: string }
  | { status: 'already_queued'; jobId: string };

/**
 * Enqueue a backfill job with deduplication.
 * Uses deterministic job IDs so duplicate jobs are never queued.
 *
 * @param data - The job data
 * @returns Result indicating if job was queued or already exists
 */
export async function enqueueBackfillJob(
  data: BackfillJobData
): Promise<EnqueueBackfillResult> {
  const queue = getBackfillQueue();
  const jobId = buildBackfillJobId(data.provider, data.userId, data.year);

  try {
    await queue.add('backfillYear', data, { jobId });
    console.log(`[BackfillQueue] Enqueued job ${jobId}`);
    return { status: 'queued', jobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('Job') && message.includes('already exists')) {
      console.log(`[BackfillQueue] Job ${jobId} already exists (duplicate rejected)`);
      return { status: 'already_queued', jobId };
    }

    throw err;
  }
}

/**
 * Build a deterministic job ID for callback processing jobs.
 * Uses MD5 hash of callback URL for deduplication.
 */
export function buildCallbackJobId(
  provider: BackfillProvider,
  userId: string,
  callbackURL: string
): string {
  const urlHash = crypto.createHash('md5').update(callbackURL).digest('hex').slice(0, 12);
  return `processCallback_${provider}_${userId}_${urlHash}`;
}

/**
 * Enqueue a callback processing job with deduplication.
 * Used when Garmin sends a callback URL in response to a backfill request.
 *
 * @param data - The job data including userId, provider, and callbackURL
 * @returns Result indicating if job was queued or already exists
 */
export async function enqueueCallbackJob(
  data: { userId: string; provider: BackfillProvider; callbackURL: string }
): Promise<EnqueueBackfillResult> {
  const queue = getBackfillQueue();
  const jobId = buildCallbackJobId(data.provider, data.userId, data.callbackURL);

  try {
    await queue.add('processCallback', data, { jobId });
    logger.info({ jobId, userId: data.userId }, '[BackfillQueue] Enqueued callback job');
    return { status: 'queued', jobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('Job') && message.includes('already exists')) {
      logger.debug({ jobId }, '[BackfillQueue] Callback job already exists (duplicate rejected)');
      return { status: 'already_queued', jobId };
    }

    throw err;
  }
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
