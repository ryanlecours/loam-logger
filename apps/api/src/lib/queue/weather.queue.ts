import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

const SECONDS = 1000;
const INITIAL_RETRY_DELAY_MS = 5 * SECONDS;
const MAX_RETRY_ATTEMPTS = 5;
const COMPLETED_JOBS_TO_KEEP = 50;
const FAILED_JOBS_TO_KEEP = 100;
const LOW_PRIORITY = 10;

export type WeatherJobName = 'fetchWeather';

export type WeatherJobData = {
  rideId: string;
};

let weatherQueue: Queue<WeatherJobData, void, WeatherJobName> | null = null;

export function getWeatherQueue(): Queue<WeatherJobData, void, WeatherJobName> {
  if (!weatherQueue) {
    weatherQueue = new Queue<WeatherJobData, void, WeatherJobName>('weather', {
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
  return weatherQueue;
}

export function buildWeatherJobId(rideId: string): string {
  return `fetchWeather_${rideId}`;
}

export type EnqueueWeatherResult =
  | { status: 'queued'; jobId: string }
  | { status: 'already_queued'; jobId: string };

// BullMQ `add` with a static jobId is idempotent: Redis dedupes at the queue
// level, so no duplicate work runs even under concurrent calls for the same
// rideId. We check existence first to report `already_queued` as a hint to
// callers, but this check is best-effort: two concurrent callers can both see
// "not existing" and both call add — Redis absorbs the second call, but both
// return `queued`. Downstream code must not treat `enqueuedCount` as a
// Redis-accurate counter; it's a soft upper bound on jobs-added-this-call.
export async function enqueueWeatherJob(data: WeatherJobData): Promise<EnqueueWeatherResult> {
  const queue = getWeatherQueue();
  const jobId = buildWeatherJobId(data.rideId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    // completed/failed jobs are gone (or soon to be) — re-adding is fine.
    if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
      return { status: 'already_queued', jobId };
    }
  }
  await queue.add('fetchWeather', data, { jobId });
  return { status: 'queued', jobId };
}

export async function closeWeatherQueue(): Promise<void> {
  if (weatherQueue) {
    await weatherQueue.close();
    weatherQueue = null;
  }
}
