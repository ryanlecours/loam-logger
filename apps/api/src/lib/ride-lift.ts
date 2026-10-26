import { prisma } from './prisma';
import type { pointsFromStream } from './lift-detection';

// The rider-facing side of lift detection: which lifts a ride used, and the
// rider's per-ride choice about whether the lift's climb counts in that
// ride's elevation gain.
//
// Only segments matched to a mapped chairlift or gondola count here: the
// segment's liftOsmId must name an aerialway in the active geometry snapshot
// whose kind is CHAIRLIFT or GONDOLA. Everything else stays in RideSegment
// and the Ride lift columns for the admin tools, but the rider never sees it
// and it never removes climb:
//  - Segments found from motion alone. On real rides they were mostly steady
//    pedal climbs (2026-10-26: 28 of one rider's 30 flagged rides had no
//    mapped lift, at places with no chairlift).
//  - Surface lifts (t-bar, j-bar, platter, rope tow, magic carpet). They do
//    not carry a mountain bike, so a match is a rider climbing beside the
//    line (the same rider's one remaining false lift was a ski area T-Bar).
//  - Lifts missing from the active snapshot, whose kind cannot be confirmed.
//
// Scope is elevation only. Lift time and distance stay in the ride's numbers,
// and nothing server-side reads the choice: component hours, the wear model
// and the bikeHistory/componentHistory totals all stay on the raw columns
// (see the note in component-history.ts). Clients use countedElevationGainMeters
// for the ride itself and for the stats they compute from the rides list.

/**
 * What an unanswered choice (Ride.countLiftElevation IS NULL) means. A lift
 * carried the rider up that climb, so by default it does not count; the rider
 * can add it back per ride. A constant rather than a column default so it can
 * change without rewriting rows that hold no real answer.
 */
export const LIFT_ELEVATION_COUNTED_BY_DEFAULT = false;

export type RideLiftKind = 'CHAIRLIFT' | 'GONDOLA' | 'OTHER';

/** The Ride columns the lift choice reads. */
export interface LiftElevationFields {
  elevationGainMeters: number;
  liftDurationSeconds: number | null;
  liftElevationGainMeters: number | null;
  /** Climb summed over the whole stored track; null until the worker or the backfill writes it. */
  trackElevationGainMeters: number | null;
  countLiftElevation: boolean | null;
}

export interface RideLiftSegmentResult {
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  elevationGainMeters: number;
  distanceMeters: number;
  liftName: string | null;
  /** CHAIRLIFT or GONDOLA: the only kinds that count (RIDEABLE_LIFT_KINDS). */
  kind: RideLiftKind | null;
}

export interface RideLiftResult {
  segments: RideLiftSegmentResult[];
  elevationGainMeters: number;
  countElevation: boolean;
  countElevationChoice: boolean | null;
}

/**
 * Whether the detector stored any lift segments for this ride, read from the
 * Ride columns so no segment query is needed. The lift worker writes the
 * segments and the lift columns in one transaction, and liftDurationSeconds is
 * the sum of the segments' durations: it is above zero exactly when segments
 * exist. NULL means never analyzed, which also has no segments.
 *
 * A cheap pre-check only: those segments may all be motion-only, so callers
 * that get true still load the mapped segments and decide from those.
 */
export function hasDetectedLift(ride: Pick<LiftElevationFields, 'liftDurationSeconds'>): boolean {
  return ride.liftDurationSeconds != null && ride.liftDurationSeconds > 0;
}

/** The effective answer for a stored choice, applying the default to NULL. */
export function countsLiftElevation(choice: boolean | null | undefined): boolean {
  return choice ?? LIFT_ELEVATION_COUNTED_BY_DEFAULT;
}

/**
 * How far altitude must move from its last turning point before the move
 * counts toward the track climb. Summing every raw up-step turns altitude
 * jitter into climb: a phone recording at Whistler (GPS altitude, no
 * barometer) summed to about 16,600 ft for a day whose lifts rose 7,468 ft,
 * which made most of the day look like riding. Devices filter the same way
 * before reporting a climb. Chosen on production tracks (see
 * scripts/backfill-track-climb.ts --threshold).
 */
export const TRACK_CLIMB_HYSTERESIS_METERS = 5;

/**
 * Climb with hysteresis: a rise counts once altitude has gone thresholdMeters
 * above the last low point, and a drop of thresholdMeters resets the low
 * point. Noise smaller than the threshold adds nothing; a steady climb keeps
 * all but the last few meters. Non-finite altitudes are skipped.
 */
export function hysteresisClimbMeters(
  elevations: ReadonlyArray<number>,
  thresholdMeters: number = TRACK_CLIMB_HYSTERESIS_METERS
): number {
  let ref: number | null = null;
  let gain = 0;
  for (const ele of elevations) {
    if (!Number.isFinite(ele)) continue;
    if (ref == null) {
      ref = ele;
    } else if (ele - ref >= thresholdMeters) {
      gain += ele - ref;
      ref = ele;
    } else if (ref - ele >= thresholdMeters) {
      ref = ele;
    }
  }
  return gain;
}

/**
 * Climb over the whole track, lifts included, or null when the track cannot
 * say. Written to Ride.trackElevationGainMeters by the lift worker and the
 * backfill script, and used as the denominator for the share of a ride's
 * climb a lift did.
 *
 * Inside a lift segment the climb is the segment's net rise (last altitude
 * minus first), the same figure the segment stores. Between segments it is
 * the hysteresis-smoothed climb. Smoothing alone is not enough on a phone:
 * at Whistler the GPS altitude "climbed" 3,580 m during lift rides that rose
 * 2,276 m, which inflated the denominator and counted lift noise as riding.
 * Fewer than two points have no climb to sum.
 */
export function trackClimbMeters(
  points: ReturnType<typeof pointsFromStream>,
  liftSegments: ReadonlyArray<{ startIndex: number; endIndex: number }> = [],
  thresholdMeters: number = TRACK_CLIMB_HYSTERESIS_METERS
): number | null {
  if (!points || points.length < 2) return null;
  const spans = [...liftSegments]
    .filter((s) => s.startIndex >= 0 && s.endIndex < points.length && s.startIndex <= s.endIndex)
    .sort((a, b) => a.startIndex - b.startIndex);
  let gain = 0;
  const climb = (lo: number, hi: number) =>
    hysteresisClimbMeters(points.slice(lo, hi + 1).map((p) => p.ele), thresholdMeters);
  // `last` is the index the previous span ended on; riding resumes there, so
  // the steps into and out of a lift are counted as riding.
  let last = 0;
  for (const span of spans) {
    // Overlapping spans should not occur; start at the previous end rather
    // than count the overlap twice.
    if (span.endIndex <= last && last > 0) continue;
    const start = Math.max(span.startIndex, last);
    gain += climb(last, start);
    const rise = points[span.endIndex].ele - points[start].ele;
    if (Number.isFinite(rise) && rise > 0) gain += rise;
    last = span.endIndex;
  }
  gain += climb(last, points.length - 1);
  return Number.isFinite(gain) ? gain : null;
}

/** Climb the mapped lifts did: each segment's rise, summed. */
export function liftRiseMeters(segments: ReadonlyArray<{ elevationGainMeters: number }>): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.elevationGainMeters), 0);
}

/**
 * The ride's elevation gain after the rider's lift choice. Equals the stored
 * elevationGainMeters unless a mapped lift climbed for the rider and that
 * climb is not counted.
 *
 * Proportional, not a subtraction. The recorded climb comes from the device
 * or provider summary, which smooths altitude its own way, while the lift's
 * rise is measured on the raw track. The two scales differ, and subtracting
 * one from the other wiped out whole rides: a Whistler day with 7,468 ft of
 * lift rise against 6,711 ft recorded counted 0. Instead the lift's share of
 * the track's own climb is taken out of the recorded figure:
 *
 *   counted = recorded * (track climb - lift rise) / track climb
 *
 * so the result stays on the recorded figure's scale and only reaches 0 when
 * every foot of the track's climb was on a lift. Until the track climb is
 * known (rides analyzed before the column existed and not yet backfilled),
 * it falls back to the subtraction, floored at zero.
 */
export function countedElevationGainMeters(ride: LiftElevationFields, liftRise: number): number {
  const recorded = ride.elevationGainMeters;
  if (!(liftRise > 0) || countsLiftElevation(ride.countLiftElevation)) return recorded;
  const track = ride.trackElevationGainMeters;
  if (track != null && track > 0) {
    return (recorded * Math.max(0, track - liftRise)) / track;
  }
  return Math.max(0, recorded - liftRise);
}

/**
 * Folds the OSM aerialway tag into the families the UI names. mixed_lift is a
 * chairlift line that also carries gondola cabins; riders call it a chair.
 */
export function liftKindFromAerialway(aerialway: string | null | undefined): RideLiftKind | null {
  if (!aerialway) return null;
  switch (aerialway) {
    case 'chair_lift':
    case 'mixed_lift':
      return 'CHAIRLIFT';
    case 'gondola':
    case 'cable_car':
      return 'GONDOLA';
    default:
      return 'OTHER';
  }
}

/**
 * Batch loader: the lift-choice columns for rides whose parent row was read
 * with a narrow select. Missing rides come back null.
 */
export async function batchLiftFieldsByRideId(
  rideIds: readonly string[]
): Promise<(LiftElevationFields | null)[]> {
  const rows = await prisma.ride.findMany({
    where: { id: { in: [...rideIds] } },
    select: {
      id: true,
      elevationGainMeters: true,
      liftDurationSeconds: true,
      liftElevationGainMeters: true,
      trackElevationGainMeters: true,
      countLiftElevation: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rideIds.map((id) => byId.get(id) ?? null);
}

/**
 * Segments matched to a mapped lift of any kind: the database-side prefilter.
 * Which of them count is decided by kind, in batchLiftSegmentsByRideId.
 */
export const MAPPED_LIFT_SEGMENT_WHERE = { kind: 'LIFT', liftOsmId: { not: null } } as const;

/** The lift kinds that carry a rider and a bike up a hill. */
export const RIDEABLE_LIFT_KINDS: ReadonlySet<RideLiftKind> = new Set<RideLiftKind>(['CHAIRLIFT', 'GONDOLA']);

/**
 * Batch loader: each ride's lift segments that count (see the header: a
 * mapped chairlift or gondola), in ride order, with the lift's kind looked up
 * in the active geometry snapshot by OSM id. Ride.lift, the counted climb and
 * the setRideLiftElevation guard all read this, so they agree on what a lift
 * is.
 */
export async function batchLiftSegmentsByRideId(
  rideIds: readonly string[]
): Promise<RideLiftSegmentResult[][]> {
  const segments = await prisma.rideSegment.findMany({
    where: { rideId: { in: [...rideIds] }, ...MAPPED_LIFT_SEGMENT_WHERE },
    orderBy: [{ rideId: 'asc' }, { startTime: 'asc' }],
    select: {
      rideId: true,
      startTime: true,
      endTime: true,
      durationSeconds: true,
      elevationGainMeters: true,
      distanceMeters: true,
      liftName: true,
      liftOsmId: true,
    },
  });

  const osmIds = [...new Set(segments.map((s) => s.liftOsmId).filter((id): id is string => !!id))];
  const kindByOsmId = new Map<string, string>();
  if (osmIds.length > 0) {
    const lines = await prisma.liftGeometryLine.findMany({
      where: { osmId: { in: osmIds }, import: { status: 'ACTIVE' } },
      select: { osmId: true, kind: true },
    });
    for (const line of lines) kindByOsmId.set(line.osmId, line.kind);
  }

  const byRide = new Map<string, RideLiftSegmentResult[]>();
  for (const s of segments) {
    const kind = s.liftOsmId ? liftKindFromAerialway(kindByOsmId.get(s.liftOsmId)) : null;
    if (!kind || !RIDEABLE_LIFT_KINDS.has(kind)) continue;
    const list = byRide.get(s.rideId) ?? [];
    list.push({
      startTime: s.startTime,
      endTime: s.endTime,
      durationSeconds: s.durationSeconds,
      elevationGainMeters: s.elevationGainMeters,
      distanceMeters: s.distanceMeters,
      liftName: s.liftName,
      kind,
    });
    byRide.set(s.rideId, list);
  }
  return rideIds.map((id) => byRide.get(id) ?? []);
}

/**
 * The Ride.lift payload, or null when no lift that counts was found on the
 * ride. The climb is summed over those segments only, so it is exactly what
 * countedElevationGainMeters takes out.
 */
export function buildRideLift(
  fields: LiftElevationFields,
  segments: RideLiftSegmentResult[]
): RideLiftResult | null {
  if (segments.length === 0) return null;
  return {
    segments,
    elevationGainMeters: liftRiseMeters(segments),
    countElevation: countsLiftElevation(fields.countLiftElevation),
    countElevationChoice: fields.countLiftElevation,
  };
}
