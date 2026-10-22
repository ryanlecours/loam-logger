import '../instrument';
import { Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { reportWorkerFailure } from './report-failure';
import { getQueueConnection } from '../lib/queue/connection';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { LiftJobData, LiftJobName } from '../lib/queue';
import { getValidStravaToken } from '../lib/strava-token';
import { fetchStravaStreams } from '../lib/strava-streams';
import type { NormalizedStreams } from '../lib/ride-streams';
import { saveRideStream } from '../lib/ride-stream-store';
import {
  DETECTOR_VERSION,
  DEFAULT_OPTIONS,
  KINEMATIC_ONLY_OPTIONS,
  pointsFromStream,
  detectLiftSegments,
  computeAdjustedMetrics,
  getLiftLines,
} from '../lib/lift-detection';

/**
 * Descent summed over the track, or null when the track cannot say.
 *
 * The sum leaves out the steps inside the given lift segments, exactly as
 * computeAdjustedMetrics does for gain, so a downhill gondola the detector
 * excluded is not booked as riding. Both callers therefore pass the segments
 * that describe this stream: freshly detected ones on the full pipeline, the
 * stored ones on the descent-only path. computeAdjustedMetrics sums finite
 * altitudes from zero, so it always returns a number, but a track
 * with fewer than two points has no descent to sum and would store 0 ("flat
 * ride") where the contract wants null ("not reported"). The finite guard keeps
 * a malformed stream from writing NaN and then re-running this job on every
 * enqueue because the column reads as unset.
 */
function deriveStreamLoss(
  points: ReturnType<typeof pointsFromStream>,
  segments: Array<{ startIndex: number; endIndex: number }>
): number | null {
  if (!points || points.length < 2) return null;
  const loss = computeAdjustedMetrics(points, segments).elevationLossMeters;
  return Number.isFinite(loss) ? loss : null;
}

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
      garminActivityId: true,
      startLat: true,
      startLng: true,
      liftDetectorVersion: true,
      elevationLossMeters: true,
      stream: { select: { id: true, data: true } },
      // The detector's answer on record, for the descent-only path below.
      segments: { select: { startIndex: true, endIndex: true } },
    },
  });

  if (!ride) {
    logger.debug({ rideId }, '[LiftWorker] Ride not found, skipping');
    return;
  }
  if (ride.startLat == null || ride.startLng == null) {
    logger.debug({ rideId }, '[LiftWorker] Ride has no coords, skipping');
    return;
  }
  // A forced job (admin re-analysis) takes the full pipeline whatever the
  // ride's version says, so the two early exits below do not apply to it.
  const force = job.data.force === true;

  // A ride analyzed at the current version is done, unless it still has no
  // descent: this job is also how a ride without a provider-reported descent
  // gets one from its stream, and re-running costs no provider call.
  if (
    !force &&
    ride.stream &&
    ride.liftDetectorVersion === DETECTOR_VERSION &&
    ride.elevationLossMeters != null
  ) {
    logger.debug({ rideId }, '[LiftWorker] Already analyzed at current detector version, skipping');
    return;
  }

  // Step 1: obtain the raw stream. An existing stream is always reused, so
  // re-detection after a DETECTOR_VERSION bump costs no provider call.
  //
  // The two providers differ in how a stream comes to exist:
  //  - Strava streams are fetched here, lazily, on first analysis.
  //  - Garmin streams are written at ingest from the Activity Details samples
  //    Garmin pushes (see lib/ride-stream-store.ts). There is no fetch path —
  //    the Connect Developer Program disallows pull-only access — so a Garmin
  //    ride with no stored stream simply has no track to analyze.
  const hadStoredStream = Boolean(ride.stream);
  let streamData: NormalizedStreams;
  if (ride.stream) {
    streamData = ride.stream.data as NormalizedStreams;
  } else if (ride.stravaActivityId) {
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

    await saveRideStream(rideId, 'strava', result.pointCount, result.data);
    streamData = result.data;
  } else {
    logger.debug(
      { rideId, isGarmin: Boolean(ride.garminActivityId) },
      '[LiftWorker] No stored stream and no fetchable source, skipping'
    );
    return;
  }

  const points = pointsFromStream(streamData);
  if (!points) {
    // No altitude series — cannot analyze. Leave liftDetectorVersion null
    // ("never analyzed") rather than record a false "no lift found".
    logger.debug({ rideId }, '[LiftWorker] Stream has no altitude, leaving unanalyzed');
    return;
  }

  // Already analyzed at the current version and missing only the descent.
  // The segments on record are the detector's answer; sum descent from the
  // stream and stop. No Overpass call and no re-detection, because a re-run
  // under Overpass rate limiting (which a thousand-ride backfill burst
  // produced) replaces geometry-matched segments with kinematic-only ones.
  //
  // Gated on the stream having been stored already, not fetched just now: a
  // current-version ride can have lost its stream (a Strava disconnect
  // deletes streams, rides survive), and its stored segments index into the
  // old stream, so a refetched one goes through the full pipeline instead.
  // The descent check matters for the same ride when it kept a
  // provider-reported descent: the full pipeline leaves a non-null descent
  // alone, so nothing here can overwrite a provider figure.
  if (
    !force &&
    hadStoredStream &&
    ride.liftDetectorVersion === DETECTOR_VERSION &&
    ride.elevationLossMeters == null
  ) {
    const loss = deriveStreamLoss(points, ride.segments);
    if (loss != null) {
      // Compare-and-set: an ingest that wrote a provider descent between the
      // read above and this write wins, as it would in the full pipeline.
      await prisma.ride.updateMany({
        where: { id: rideId, elevationLossMeters: null },
        data: { elevationLossMeters: loss },
      });
    }
    logger.debug({ rideId, filled: loss != null }, '[LiftWorker] Descent filled from stored stream');
    return;
  }

  // Step 2: lift geometry, best-effort (getLiftLines never throws).
  const { geometryAvailable, liftLines, reason } = await getLiftLines(points);

  // A job that must have geometry defers rather than degrades. Persisting a
  // kinematic-only result here would replace the segments on record, which
  // on this path are the very geometry-matched ones being restored, so the
  // job throws and BullMQ retries it on the slower geometry backoff. Only a
  // failed fetch is worth retrying: a ride too large for the geometry layer
  // gets its kinematic-only answer on any attempt, so it proceeds.
  if (job.data.requireGeometry && !geometryAvailable && reason === 'fetch_failed') {
    throw new Error(
      `Lift geometry unavailable for ride ${rideId}; deferring rather than storing a kinematic-only result`
    );
  }

  // Step 3: pure detection. Without geometry, Layer B alone must clear the
  // stricter bar (plan §3.2).
  const detected = detectLiftSegments(
    points,
    liftLines,
    geometryAvailable ? DEFAULT_OPTIONS : KINEMATIC_ONLY_OPTIONS
  );

  // Descent from the stream, written only when no provider reported one.
  // Garmin and Suunto send a smoothed figure at ingest and that number wins;
  // Strava and in-app rides have nothing else, so the stream is their source.
  const derivedElevationLoss =
    ride.elevationLossMeters == null ? deriveStreamLoss(points, detected) : null;

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
        ...(derivedElevationLoss != null ? { elevationLossMeters: derivedElevationLoss } : {}),
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
    reportWorkerFailure('lift', job, err);
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
