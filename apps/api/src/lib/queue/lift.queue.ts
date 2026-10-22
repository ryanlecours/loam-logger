import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

const SECONDS = 1000;
const INITIAL_RETRY_DELAY_MS = 10 * SECONDS;
const MAX_RETRY_ATTEMPTS = 4;
// A job that must have lift geometry fails when Overpass is rate limiting,
// and Overpass asks clients that saw a 429 to wait at least 30 seconds before
// the next query. Retrying at 60s and then 120s honors that with margin; the
// default 10s backoff would just be counted as more load.
const GEOMETRY_RETRY_DELAY_MS = 60 * SECONDS;
const GEOMETRY_RETRY_ATTEMPTS = 3;
const COMPLETED_JOBS_TO_KEEP = 50;
const FAILED_JOBS_TO_KEEP = 100;
// Below sync but alongside weather: enrichment, never latency-sensitive.
const LOW_PRIORITY = 10;

export type LiftJobName = 'detectLifts';

export type LiftJobData = {
  rideId: string;
  /**
   * Run the full pipeline even if the ride is already analyzed at the current
   * detector version: no "already analyzed" skip and no descent-only path.
   * Set by the admin re-analysis routes, so that the job itself carries the
   * instruction and nothing depends on the ride's version being cleared
   * before the worker reads it.
   */
  force?: boolean;
  /**
   * Refuse to persist a kinematic-only result: when Overpass is unavailable
   * the job throws and BullMQ retries it later, instead of replacing whatever
   * segments are on record with weaker ones. Set by the admin re-analysis
   * path that repairs rides degraded by an Overpass outage.
   */
  requireGeometry?: boolean;
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
// idempotent at the Redis level while a job for the ride is queued or
// running; the existence check only refines the return status and is
// best-effort under concurrency.
//
// BullMQ keeps the last few completed and failed jobs (removeOnComplete /
// removeOnFail above) and ignores an `add` whose id still exists in either
// set, so a ride analyzed recently could not be re-analyzed at all: the admin
// force path cleared its detector version and the enqueue silently did
// nothing. A terminal job under this id is removed first, as the Garmin
// coordinate-repair enqueue does.
export async function enqueueLiftDetectionJob(data: LiftJobData): Promise<EnqueueLiftResult> {
  const queue = getLiftQueue();
  const jobId = buildLiftJobId(data.rideId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
      return { status: 'already_queued', jobId };
    }
    // The state read above is not a lock. If the job moved on in between
    // (a failed job whose retry just started) the removal throws because the
    // job is locked, and "a job for this ride is running" is then the truth.
    try {
      await existing.remove();
    } catch {
      return { status: 'already_queued', jobId };
    }
  }
  await queue.add('detectLifts', data, {
    jobId,
    ...(data.requireGeometry
      ? {
          attempts: GEOMETRY_RETRY_ATTEMPTS,
          backoff: { type: 'exponential', delay: GEOMETRY_RETRY_DELAY_MS },
        }
      : {}),
  });
  return { status: 'queued', jobId };
}

export async function closeLiftQueue(): Promise<void> {
  if (liftQueue) {
    await liftQueue.close();
    liftQueue = null;
  }
}
