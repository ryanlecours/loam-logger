import { Worker, Job } from 'bullmq';
import { getQueueConnection } from '../lib/queue/connection';
import { reverseGeocode } from '../lib/location';
import { prisma } from '../lib/prisma';
import type { GeocodeJobData, GeocodeJobName } from '../lib/queue/geocode.queue';

/**
 * Process a geocode job by reverse geocoding coordinates and updating the ride.
 */
async function processGeocodeJob(job: Job<GeocodeJobData, void, GeocodeJobName>): Promise<void> {
  const { rideId, lat, lon } = job.data;

  console.log(`[GeocodeWorker] Processing ride ${rideId} at (${lat}, ${lon})`);

  // Validate job data
  if (!rideId || typeof rideId !== 'string') {
    throw new Error('Invalid job data: rideId is required');
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Invalid job data: lat and lon must be valid numbers');
  }

  // Reverse geocode the coordinates
  const location = await reverseGeocode(lat, lon);

  if (!location) {
    console.log(`[GeocodeWorker] No location found for ride ${rideId} at (${lat}, ${lon})`);
    return; // Not an error - some coordinates may not resolve to a location
  }

  // Update the ride with the geocoded location
  // Only update if the current location is still in "Lat X, Lon Y" format
  // This prevents overwriting user-edited locations
  const result = await prisma.ride.updateMany({
    where: {
      id: rideId,
      location: { startsWith: 'Lat ' },
    },
    data: { location },
  });

  if (result.count > 0) {
    console.log(`[GeocodeWorker] Updated ride ${rideId} location to: ${location}`);
  } else {
    console.log(`[GeocodeWorker] Ride ${rideId} not found or location already set, skipping`);
  }
}

let geocodeWorker: Worker<GeocodeJobData, void, GeocodeJobName> | null = null;

/**
 * Create and start the geocode worker.
 * Concurrency is set to 1 to respect Nominatim API rate limit (1 req/sec).
 * The reverseGeocode function has built-in rate limiting with 1.1s spacing.
 */
export function createGeocodeWorker(): Worker<GeocodeJobData, void, GeocodeJobName> {
  if (geocodeWorker) {
    return geocodeWorker;
  }

  geocodeWorker = new Worker<GeocodeJobData, void, GeocodeJobName>(
    'geocode',
    processGeocodeJob,
    {
      connection: getQueueConnection(),
      // Concurrency of 1 ensures sequential processing for rate limiting
      concurrency: 1,
      // Reduce polling frequency when idle to lower Redis costs
      settings: {
        stalledInterval: 60000, // Check for stalled jobs every 60s (default 30s)
      },
      drainDelay: 5000, // Wait 5s between empty polls (default 0)
    }
  );

  geocodeWorker.on('completed', (job) => {
    console.log(`[GeocodeWorker] Job ${job.id} completed`);
  });

  geocodeWorker.on('failed', (job, err) => {
    console.error(`[GeocodeWorker] Job ${job?.id} failed:`, err.message);
  });

  geocodeWorker.on('error', (err) => {
    console.error('[GeocodeWorker] Worker error:', err.message);
  });

  console.log('[GeocodeWorker] Started');
  return geocodeWorker;
}

/**
 * Stop and close the geocode worker.
 */
export async function closeGeocodeWorker(): Promise<void> {
  if (geocodeWorker) {
    await geocodeWorker.close();
    geocodeWorker = null;
    console.log('[GeocodeWorker] Stopped');
  }
}
