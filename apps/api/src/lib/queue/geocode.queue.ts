import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

// Job retry configuration
const INITIAL_RETRY_DELAY_MS = 2000; // 2 seconds
const MAX_RETRY_ATTEMPTS = 3;
const COMPLETED_JOBS_TO_KEEP = 10;
const FAILED_JOBS_TO_KEEP = 50;

export type GeocodeJobName = 'geocodeRide';

export type GeocodeJobData = {
  rideId: string;
  lat: number;
  lon: number;
};

let geocodeQueue: Queue<GeocodeJobData, void, GeocodeJobName> | null = null;

/**
 * Get or create the geocode queue singleton.
 */
export function getGeocodeQueue(): Queue<GeocodeJobData, void, GeocodeJobName> {
  if (!geocodeQueue) {
    geocodeQueue = new Queue<GeocodeJobData, void, GeocodeJobName>('geocode', {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: INITIAL_RETRY_DELAY_MS,
        },
        removeOnComplete: COMPLETED_JOBS_TO_KEEP,
        removeOnFail: FAILED_JOBS_TO_KEEP,
        // Lower priority than sync jobs (higher number = lower priority)
        priority: 20,
      },
    });
  }
  return geocodeQueue;
}

/**
 * Add a geocode job to the queue.
 * Uses rideId as job ID to prevent duplicate geocoding of the same ride.
 *
 * @returns true if job was added, false if duplicate was ignored
 */
export async function addGeocodeJob(data: GeocodeJobData): Promise<boolean> {
  const queue = getGeocodeQueue();
  const jobId = `geocode-${data.rideId}`;

  try {
    await queue.add('geocodeRide', data, { jobId });
    return true;
  } catch (err) {
    // BullMQ throws "Job with id X already exists" for duplicates
    if (err instanceof Error && err.message.includes('already exists')) {
      console.warn(`[GeocodeQueue] Duplicate job ignored: ${jobId}`);
      return false;
    }
    throw err;
  }
}

/**
 * Close the geocode queue connection.
 */
export async function closeGeocodeQueue(): Promise<void> {
  if (geocodeQueue) {
    await geocodeQueue.close();
    geocodeQueue = null;
  }
}
