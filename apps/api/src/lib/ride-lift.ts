import { prisma } from './prisma';

// The rider-facing side of lift detection: which lifts a ride used, and the
// rider's per-ride choice about whether the lift's climb counts in that
// ride's elevation gain.
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
  countLiftElevation: boolean | null;
}

export interface RideLiftSegmentResult {
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  elevationGainMeters: number;
  distanceMeters: number;
  liftName: string | null;
  /** Null when the segment was not matched to a mapped lift. */
  kind: RideLiftKind | null;
}

export interface RideLiftResult {
  segments: RideLiftSegmentResult[];
  elevationGainMeters: number;
  countElevation: boolean;
  countElevationChoice: boolean | null;
}

/**
 * Whether the detector stored lift segments for this ride, read from the Ride
 * columns so no segment query is needed. The lift worker writes the segments
 * and the lift columns in one transaction, and liftDurationSeconds is the sum
 * of the segments' durations: it is above zero exactly when segments exist
 * (a lift ride lasts minutes, so a real segment never rounds to 0 s). NULL
 * means never analyzed, which also has no segments.
 *
 * This is the one "has a lift" test. The climb is a separate question: a
 * downhill or flat lift has segments and a lift climb of 0, so the rider can
 * still see it and save a choice, which then changes no number.
 */
export function hasDetectedLift(ride: Pick<LiftElevationFields, 'liftDurationSeconds'>): boolean {
  return ride.liftDurationSeconds != null && ride.liftDurationSeconds > 0;
}

/** The effective answer for a stored choice, applying the default to NULL. */
export function countsLiftElevation(choice: boolean | null | undefined): boolean {
  return choice ?? LIFT_ELEVATION_COUNTED_BY_DEFAULT;
}

/**
 * The ride's elevation gain after the rider's lift choice. Equals the stored
 * elevationGainMeters unless a lift climbed for the rider and that climb is
 * not counted. Floored at zero: a rider who lowered the ride's climb by hand
 * below the lift's share should see 0, never a negative climb. Keys off the
 * lift climb rather than hasDetectedLift: with no climb to remove, the
 * recorded figure stands whatever the choice says.
 */
export function countedElevationGainMeters(ride: LiftElevationFields): number {
  const lift = ride.liftElevationGainMeters;
  if (lift == null || !(lift > 0) || countsLiftElevation(ride.countLiftElevation)) {
    return ride.elevationGainMeters;
  }
  return Math.max(0, ride.elevationGainMeters - lift);
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
      countLiftElevation: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rideIds.map((id) => byId.get(id) ?? null);
}

/**
 * Batch loader: each ride's LIFT segments in ride order, with the lift's kind
 * looked up in the active geometry snapshot by OSM id. A segment whose lift is
 * not in the active snapshot (matched against an older one, or not matched at
 * all) gets a null kind, and the UI falls back to the generic word "lift".
 */
export async function batchLiftSegmentsByRideId(
  rideIds: readonly string[]
): Promise<RideLiftSegmentResult[][]> {
  const segments = await prisma.rideSegment.findMany({
    where: { rideId: { in: [...rideIds] }, kind: 'LIFT' },
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
    const list = byRide.get(s.rideId) ?? [];
    list.push({
      startTime: s.startTime,
      endTime: s.endTime,
      durationSeconds: s.durationSeconds,
      elevationGainMeters: s.elevationGainMeters,
      distanceMeters: s.distanceMeters,
      liftName: s.liftName,
      kind: s.liftOsmId ? liftKindFromAerialway(kindByOsmId.get(s.liftOsmId)) : null,
    });
    byRide.set(s.rideId, list);
  }
  return rideIds.map((id) => byRide.get(id) ?? []);
}

/**
 * The Ride.lift payload, or null when no lift was detected on the ride. The
 * climb comes from the Ride column the detector wrote alongside the segments,
 * so it always matches what countedElevationGainMeters subtracts.
 */
export function buildRideLift(
  fields: LiftElevationFields,
  segments: RideLiftSegmentResult[]
): RideLiftResult | null {
  if (segments.length === 0) return null;
  return {
    segments,
    elevationGainMeters:
      fields.liftElevationGainMeters ?? segments.reduce((sum, s) => sum + s.elevationGainMeters, 0),
    countElevation: countsLiftElevation(fields.countLiftElevation),
    countElevationChoice: fields.countLiftElevation,
  };
}
