import { logger } from './logger';
import type { NormalizedStreams, RideStreamsResult } from './ride-streams';

/**
 * Normalizer for Garmin Activity Details `samples[]`.
 *
 * This module makes NO network call: it is handed samples and returns arrays.
 *
 * Where those samples come from used to be misdescribed here, and the mistake
 * cost every Garmin ride its map. The claim was that samples arrive with the
 * activity through the PING pipeline, so there was nothing to fetch. They do
 * not. An activityDetails PING carries only a notification: a summaryId and a
 * callbackURL, and the worker was pulling `/rest/activities`, the Activity
 * SUMMARY, which has no per-point data at all. So `samples` was always
 * undefined, persistGarminStream always returned false, and every Garmin ride
 * resolved to UNAVAILABLE.
 *
 * The pull now happens in ./garmin-activity-details, against
 * `/rest/activityDetails`. That is not the "PULL-ONLY requests not allowed"
 * case the Connect Developer Program forbids: it is prompted by Garmin's own
 * ping and scoped by the callbackURL Garmin sent.
 *
 * See ./ride-streams for the shared output contract, and ./strava-streams for
 * the other provider fetcher.
 */

/**
 * One entry of Garmin's Activity Details `samples` array. Every field is
 * optional in practice — Garmin omits sensors the device didn't record, and a
 * given sample can carry a timestamp with no GPS fix.
 */
export type GarminActivitySample = {
  /** Absolute epoch seconds, NOT relative to the activity start. */
  startTimeInSeconds?: number;
  latitudeInDegree?: number;
  longitudeInDegree?: number;
  elevationInMeters?: number;
  heartRate?: number;
  speedMetersPerSecond?: number;
  bikeCadenceInRPM?: number;
  powerInWatts?: number;
  totalDistanceInMeters?: number;
  timerDurationInSeconds?: number;
  movingDurationInSeconds?: number;
  [key: string]: unknown;
};

/**
 * Below this speed a sample counts as stopped. Garmin has no `moving` flag of
 * its own (Strava does), and lift detection uses `moving` only to decide which
 * points contribute to metric deltas, so an approximate threshold is fine.
 * 0.5 m/s ≈ 1.8 km/h — slower than a walking pace, so it catches genuine stops
 * without discarding slow technical climbing.
 */
const MOVING_SPEED_THRESHOLD_MPS = 0.5;

/** A sample with no fix is reported by Garmin as an out-of-range sentinel. */
function isValidCoord(lat: number | undefined, lng: number | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // Garmin emits 0/0 for "no fix" rather than omitting the field. A genuine
    // ride at Null Island is not a case worth preserving.
    !(lat === 0 && lng === 0)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalize Garmin Activity Details samples into the shared stream shape.
 *
 * `activityStartTimeInSeconds` is the activity summary's start, used to rebase
 * Garmin's absolute per-sample timestamps onto the seconds-since-start that
 * `NormalizedStreams.time` requires.
 *
 * Samples without a timestamp or a usable GPS fix are dropped from EVERY array
 * together — RideSegment stores indexes into these arrays, so they must stay
 * index-aligned.
 */
export function normalizeGarminSamples(
  samples: GarminActivitySample[] | undefined | null,
  activityStartTimeInSeconds: number,
  context: { summaryId?: string } = {}
): RideStreamsResult {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { status: 'no_streams' };
  }

  const time: number[] = [];
  const latlng: [number, number][] = [];
  const altitude: number[] = [];
  const velocity: number[] = [];
  const cadence: number[] = [];
  const heartrate: number[] = [];
  const power: number[] = [];
  const moving: boolean[] = [];

  // Track whether each optional series carried any real data. A series that was
  // absent from every sample is omitted entirely rather than persisted as an
  // array of zeros, which downstream code would read as genuine readings —
  // `pointsFromStream` returns null on a missing altitude series, but would
  // happily treat a flat zero series as a real (and completely wrong) profile.
  let sawAltitude = false;
  let sawVelocity = false;
  let sawCadence = false;
  let sawHeartrate = false;
  let sawPower = false;

  for (const sample of samples) {
    const abs = sample.startTimeInSeconds;
    if (!isFiniteNumber(abs)) continue;
    if (!isValidCoord(sample.latitudeInDegree, sample.longitudeInDegree)) continue;

    const relative = abs - activityStartTimeInSeconds;
    // Guard against samples stamped before the summary's own start time, which
    // would produce negative offsets and corrupt segment maths.
    if (relative < 0) continue;

    time.push(relative);
    latlng.push([sample.latitudeInDegree as number, sample.longitudeInDegree as number]);

    const ele = sample.elevationInMeters;
    if (isFiniteNumber(ele)) sawAltitude = true;
    altitude.push(isFiniteNumber(ele) ? ele : 0);

    const speed = sample.speedMetersPerSecond;
    if (isFiniteNumber(speed)) sawVelocity = true;
    velocity.push(isFiniteNumber(speed) ? speed : 0);

    const rpm = sample.bikeCadenceInRPM;
    if (isFiniteNumber(rpm)) sawCadence = true;
    cadence.push(isFiniteNumber(rpm) ? rpm : 0);

    const hr = sample.heartRate;
    if (isFiniteNumber(hr)) sawHeartrate = true;
    heartrate.push(isFiniteNumber(hr) ? hr : 0);

    const watts = sample.powerInWatts;
    if (isFiniteNumber(watts)) sawPower = true;
    power.push(isFiniteNumber(watts) ? watts : 0);

    moving.push(isFiniteNumber(speed) ? speed > MOVING_SPEED_THRESHOLD_MPS : true);
  }

  if (time.length === 0) {
    logger.debug(
      { summaryId: context.summaryId, sampleCount: samples.length },
      '[GarminStreams] No samples with both a timestamp and a GPS fix'
    );
    return { status: 'no_streams' };
  }

  // Garmin does not guarantee samples arrive in chronological order. Sort by
  // time, carrying every parallel array along, so the persisted arrays satisfy
  // the monotonic-time contract lift detection depends on.
  const order = time.map((t, i) => i).sort((a, b) => time[a] - time[b]);
  const reorder = <T>(arr: T[]): T[] => order.map((i) => arr[i]);

  const data: NormalizedStreams = {
    time: reorder(time),
    latlng: reorder(latlng),
  };
  if (sawAltitude) data.altitude = reorder(altitude);
  if (sawVelocity) data.velocity = reorder(velocity);
  if (sawCadence) data.cadence = reorder(cadence);
  if (sawHeartrate) data.heartrate = reorder(heartrate);
  if (sawPower) data.power = reorder(power);
  // `moving` is derived from speed, so it is only meaningful when speed was
  // actually reported.
  if (sawVelocity) data.moving = reorder(moving);

  return { status: 'ok', pointCount: data.time.length, data };
}
