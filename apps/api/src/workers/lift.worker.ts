import '../instrument';
import { Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getQueueConnection } from '../lib/queue/connection';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { LiftJobData, LiftJobName } from '../lib/queue';
import { getValidStravaToken } from '../lib/strava-token';
import { fetchStravaStreams, type NormalizedStreams } from '../lib/strava-streams';
import {
  DETECTOR_VERSION,
  DEFAULT_OPTIONS,
  KINEMATIC_ONLY_OPTIONS,
  pointsFromStream,
  detectLiftSegments,
  getLiftLines,
} from '../lib/lift-detection';

// Shadow mode (docs/plans/lift-detection-plan.md §5, increment 2): the full
// pipeline runs — stream fetch, Overpass lookup, detection, segment + delta
// persistence — but nothing user-visible reads the results yet. Metric
// exclusion and component-hour effects arrive behind a flag in increment 5.
export async function processLiftJob(
  job: Job<LiftJobData, void, LiftJobName>
): Promise<void> {
  const { rideId } = job.data;

  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      id: true,
      userId: true,
      startTime: true,
      stravaActivityId: true,
      startLat: true,
      startLng: true,
      liftDetectorVersion: true,
      stream: { select: { id: true, data: true } },
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
  if (ride.stream && ride.liftDetectorVersion === DETECTOR_VERSION) {
    logger.debug({ rideId }, '[LiftWorker] Already analyzed at current detector version, skipping');
    return;
  }

  // Step 1: ensure the raw stream is persisted. An existing stream is reused
  // (re-detection after a DETECTOR_VERSION bump costs no Strava call).
  let streamData: NormalizedStreams;
  if (ride.stream) {
    streamData = ride.stream.data as NormalizedStreams;
  } else {
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
    streamData = result.data;
  }

  const points = pointsFromStream(streamData);
  if (!points) {
    // No altitude series — cannot analyze. Leave liftDetectorVersion null
    // ("never analyzed") rather than record a false "no lift found".
    logger.debug({ rideId }, '[LiftWorker] Stream has no altitude, leaving unanalyzed');
    return;
  }

  // Step 2: lift geometry, best-effort (getLiftLines never throws).
  const { geometryAvailable, liftLines } = await getLiftLines(points);

  // Step 3: pure detection. Without geometry, Layer B alone must clear the
  // stricter bar (plan §3.2).
  const detected = detectLiftSegments(
    points,
    liftLines,
    geometryAvailable ? DEFAULT_OPTIONS : KINEMATIC_ONLY_OPTIONS
  );

  // Step 4: persist segments and Ride deltas atomically. Delete-then-insert
  // makes re-detection idempotent.
  const rideStartMs = ride.startTime.getTime();
  await prisma.$transaction(async (tx) => {
    await tx.rideSegment.deleteMany({ where: { rideId } });
    if (detected.length > 0) {
      await tx.rideSegment.createMany({
        data: detected.map((seg) => ({
          rideId,
          kind: 'LIFT' as const,
          startIndex: seg.startIndex,
          endIndex: seg.endIndex,
          startTime: new Date(rideStartMs + seg.startTimeOffsetSec * 1000),
          endTime: new Date(rideStartMs + seg.endTimeOffsetSec * 1000),
          confidence: seg.confidence,
          // geometryScore records whether geometry informed the decision:
          // null = Overpass unavailable, 0 = geometry available but no match.
          geometryScore: geometryAvailable ? seg.geometryScore : null,
          kinematicScore: seg.kinematicScore,
          liftName: seg.matchedLiftName ?? null,
          liftOsmId: seg.matchedLiftId ?? null,
          durationSeconds: Math.round(seg.durationSec),
          elevationGainMeters: seg.elevationGainMeters,
          distanceMeters: seg.distanceMeters,
          detectorVersion: DETECTOR_VERSION,
        })),
      });
    }
    await tx.ride.update({
      where: { id: rideId },
      data: {
        liftDurationSeconds: Math.round(detected.reduce((a, s) => a + s.durationSec, 0)),
        liftElevationGainMeters: detected.reduce((a, s) => a + s.elevationGainMeters, 0),
        liftDistanceMeters: detected.reduce((a, s) => a + s.distanceMeters, 0),
        liftDetectorVersion: DETECTOR_VERSION,
      },
    });
  });

  logger.debug(
    { rideId, segments: detected.length, geometryAvailable },
    '[LiftWorker] Detection complete'
  );
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
