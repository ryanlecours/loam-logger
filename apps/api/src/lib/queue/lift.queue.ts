import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

const SECONDS = 1000;
const INITIAL_RETRY_DELAY_MS = 10 * SECONDS;
const MAX_RETRY_ATTEMPTS = 4;
const COMPLETED_JOBS_TO_KEEP = 50;
const FAILED_JOBS_TO_KEEP = 100;
// Below sync but alongside weather: enrichment, never latency-sensitive.
const LOW_PRIORITY = 10;

export type LiftJobName = 'detectLifts';

export type LiftJobData = {
  rideId: string;
};

let liftQueue: Queue<LiftJobData, void, LiftJobName> | null = null;

export function getLiftQueue(): Queue<LiftJobData, void, LiftJobName> {
  if (!liftQueue) {
    liftQueue = new Queue<LiftJobData, void, LiftJobName>('lift', {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: { type: 'exponential', delay: INITIAL_RETRY_DELAY_MS },
        priority: LOW_PRIORITY,
        removeOnComplete: COMPLETED_JOBS_TO_KEEP,
        removeOnFail: FAILED_JOBS_TO_KEEP,
      },
    });
  }
  return liftQueue;
}

export function buildLiftJobId(rideId: string): string {
  return `detectLifts_${rideId}`;
}

export type EnqueueLiftResult =
  | { status: 'queued'; jobId: string }
  | { status: 'already_queued'; jobId: string };

// Same idempotency posture as enqueueWeatherJob: the static jobId makes `add`
// idempotent at the Redis level; the existence check only refines the return
// status and is best-effort under concurrency.
export async function enqueueLiftDetectionJob(data: LiftJobData): Promise<EnqueueLiftResult> {
  const queue = getLiftQueue();
  const jobId = buildLiftJobId(data.rideId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
      return { status: 'already_queued', jobId };
    }
  }
  await queue.add('detectLifts', data, { jobId });
  return { status: 'queued', jobId };
}

export async function closeLiftQueue(): Promise<void> {
  if (liftQueue) {
    await liftQueue.close();
    liftQueue = null;
  }
}
