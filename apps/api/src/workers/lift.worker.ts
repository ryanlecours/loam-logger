import '../instrument';
import { Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getQueueConnection } from '../lib/queue/connection';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { LiftJobData, LiftJobName } from '../lib/queue';
import { getValidStravaToken } from '../lib/strava-token';
import { fetchStravaStreams } from '../lib/strava-streams';

// Increment 1 of the lift-detection plan (docs/plans/lift-detection-plan.md):
// fetch and persist the raw stream only. Detection (Overpass + kinematic
// scoring, RideSegment persistence) lands in increment 2 as later steps of
// this same job.
export async function processLiftJob(
  job: Job<LiftJobData, void, LiftJobName>
): Promise<void> {
  const { rideId } = job.data;

  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      id: true,
      userId: true,
      stravaActivityId: true,
      startLat: true,
      startLng: true,
      stream: { select: { id: true } },
    },
  });

  if (!ride) {
    logger.debug({ rideId }, '[LiftWorker] Ride not found, skipping');
    return;
  }
  if (!ride.stravaActivityId) {
    logger.debug({ rideId }, '[LiftWorker] Not a Strava ride, skipping');
    return;
  }
  if (ride.startLat == null || ride.startLng == null) {
    logger.debug({ rideId }, '[LiftWorker] Ride has no coords, skipping');
    return;
  }
  if (ride.stream) {
    logger.debug({ rideId }, '[LiftWorker] Stream already persisted, skipping');
    return;
  }

  const accessToken = await getValidStravaToken(ride.userId);
  if (!accessToken) {
    // User disconnected between import and job run — retrying won't help.
    logger.warn({ rideId, userId: ride.userId }, '[LiftWorker] No valid Strava token, skipping');
    return;
  }

  // Transient failures throw here and surface to BullMQ for retry.
  const result = await fetchStravaStreams(accessToken, ride.stravaActivityId);

  if (result.status === 'no_streams') {
    logger.debug({ rideId }, '[LiftWorker] Activity has no usable streams');
    return;
  }

  await prisma.rideStream.upsert({
    where: { rideId },
    create: {
      rideId,
      source: 'strava',
      pointCount: result.pointCount,
      data: result.data,
    },
    update: {
      source: 'strava',
      pointCount: result.pointCount,
      data: result.data,
      fetchedAt: new Date(),
    },
  });

  logger.debug({ rideId, pointCount: result.pointCount }, '[LiftWorker] Stream persisted');
}

let liftWorker: Worker<LiftJobData, void, LiftJobName> | null = null;

export function createLiftWorker(): Worker<LiftJobData, void, LiftJobName> {
  if (liftWorker) return liftWorker;

  liftWorker = new Worker<LiftJobData, void, LiftJobName>('lift', processLiftJob, {
    connection: getQueueConnection(),
    // Streams are the largest payloads we pull from Strava; keep concurrency
    // low so a burst of imports doesn't spike memory or the shared rate limit.
    concurrency: 2,
    drainDelay: 5000,
  });

  liftWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, '[LiftWorker] Completed');
  });
  liftWorker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, error: err.message }, '[LiftWorker] Job failed');
    Sentry.captureException(err, { tags: { worker: 'lift' }, extra: { jobId: job?.id } });
  });
  liftWorker.on('error', (err) => {
    logger.error({ error: err.message }, '[LiftWorker] Worker error');
    Sentry.captureException(err, { tags: { worker: 'lift' } });
  });

  return liftWorker;
}

export async function closeLiftWorker(): Promise<void> {
  if (liftWorker) {
    await liftWorker.close();
    liftWorker = null;
  }
}
