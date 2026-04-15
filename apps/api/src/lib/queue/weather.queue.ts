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

export async function enqueueWeatherJob(data: WeatherJobData): Promise<EnqueueWeatherResult> {
  const queue = getWeatherQueue();
  const jobId = buildWeatherJobId(data.rideId);
  try {
    await queue.add('fetchWeather', data, { jobId });
    return { status: 'queued', jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Job') && msg.includes('already exists')) {
      return { status: 'already_queued', jobId };
    }
    throw err;
  }
}

export async function closeWeatherQueue(): Promise<void> {
  if (weatherQueue) {
    await weatherQueue.close();
    weatherQueue = null;
  }
}
