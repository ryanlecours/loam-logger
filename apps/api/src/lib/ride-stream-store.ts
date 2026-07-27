import { prisma } from './prisma';
import { logger } from './logger';
import type { NormalizedStreams, RideStreamSource } from './ride-streams';
import { normalizeGarminSamples, type GarminActivitySample } from './garmin-streams';

/**
 * Persist one ride's normalized per-point stream.
 *
 * Provider-agnostic on purpose: the row is keyed by rideId with `source`
 * recording which provider it came from, so Strava's fetch-on-demand path and
 * Garmin's push-at-ingest path write through the same function and every
 * consumer (lift detection, the ride-track map) stays provider-blind.
 */
export async function saveRideStream(
  rideId: string,
  source: RideStreamSource,
  pointCount: number,
  data: NormalizedStreams
): Promise<void> {
  await prisma.rideStream.upsert({
    where: { rideId },
    create: { rideId, source, pointCount, data },
    update: { source, pointCount, data, fetchedAt: new Date() },
  });
}

/**
 * Delete stored streams for a provider when a user disconnects it.
 *
 * Raw per-point GPS is the most sensitive thing we hold, and it belongs to the
 * provider's grant rather than to the rider's own maintenance record. The rides
 * themselves survive — deleting those would destroy the service history the
 * product exists to keep — but the raw track goes.
 *
 * Mirrors the Strava behavior in routes/auth.strava.ts and is what Garmin
 * deregistration calls; see the retention section of the privacy policy, which
 * states exactly this split.
 */
export async function deleteRideStreamsForProvider(
  userId: string,
  source: RideStreamSource
): Promise<number> {
  const { count } = await prisma.rideStream.deleteMany({
    where: { source, ride: { userId } },
  });

  if (count > 0) {
    logger.info(
      { event: 'ride_streams_deleted', userId, source, count },
      '[RideStreams] Deleted stored streams on provider disconnect'
    );
  }

  return count;
}

/**
 * Store the per-point track for a Garmin activity, if its payload carried
 * Activity Details samples.
 *
 * Unlike Strava there is nothing to fetch — Garmin pushes samples with the
 * activity, or the ride simply has no track. Adding a pull path here would
 * also work against the Connect Developer Program's "PULL-ONLY requests not
 * allowed" requirement.
 *
 * Deliberately swallows its own errors. By the time this runs the ride and its
 * component hours are committed and Garmin will not resend the activity, so
 * losing a track degrades the map while failing the job would lose the ride.
 *
 * Called from both Garmin ingest paths — the sync worker (PING → pull by
 * summaryId) and the backfill worker (callbackURL batches).
 *
 * @returns whether a stream was actually stored, so callers can skip enqueuing
 *          lift detection for rides that have no track to analyze.
 */
export async function persistGarminStream(
  rideId: string,
  activity: {
    summaryId: string;
    startTimeInSeconds: number;
    samples?: unknown;
  }
): Promise<boolean> {
  const samples = activity.samples as GarminActivitySample[] | undefined;
  if (!Array.isArray(samples) || samples.length === 0) return false;

  try {
    const result = normalizeGarminSamples(samples, activity.startTimeInSeconds, {
      summaryId: activity.summaryId,
    });
    if (result.status === 'no_streams') return false;

    await saveRideStream(rideId, 'garmin', result.pointCount, result.data);
    logger.debug(
      { rideId, summaryId: activity.summaryId, pointCount: result.pointCount },
      '[RideStreams] Stored Garmin ride stream'
    );
    return true;
  } catch (err) {
    logger.warn(
      { event: 'garmin_stream_persist_failed', rideId, summaryId: activity.summaryId, err },
      '[RideStreams] Failed to store Garmin ride stream — ride is unaffected'
    );
    return false;
  }
}
