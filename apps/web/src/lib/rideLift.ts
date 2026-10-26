// Display helpers for lift detection: the climb a ride shows after the
// rider's per-ride lift choice, and the wording of the "lift detected" tag.
// Mirrored in loam-logger-mobile src/utils/rideLift.ts; keep the copy in step.

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

export type RideLiftKind = 'CHAIRLIFT' | 'GONDOLA' | 'OTHER';

/** The lift summary the rides list and the ride panel read (graphql LiftFields). */
export type RideLiftSummary = {
  elevationGainMeters: number;
  countElevation: boolean;
  countElevationChoice?: boolean | null;
  segments: ReadonlyArray<{ startTime?: string; liftName?: string | null; kind?: RideLiftKind | null }>;
};

type ClimbFields = {
  elevationGainMeters: number;
  countedElevationGainMeters?: number | null;
};

/**
 * The climb to show and total for a ride: the server's counted figure, which
 * leaves out a detected lift's climb unless the rider counts it. Falls back to
 * the recorded climb for a ride the cache holds without the counted field.
 */
export function rideClimbMeters(ride: ClimbFields): number {
  return ride.countedElevationGainMeters ?? ride.elevationGainMeters ?? 0;
}

/**
 * True when the shown climb differs from the recorded one because of a lift.
 * Such a figure is derived from OpenStreetMap data and needs the OSM credit
 * on the same screen.
 */
export function hasLiftAdjustedClimb(ride: ClimbFields): boolean {
  return (
    ride.countedElevationGainMeters != null &&
    ride.countedElevationGainMeters < (ride.elevationGainMeters ?? 0)
  );
}

/**
 * Whether a ride shows anything derived from the OpenStreetMap lift data: a
 * lift tag, or a climb with a lift's share left out. A list showing any such
 * ride carries the OSM credit.
 */
export function showsLiftData(ride: ClimbFields & { lift?: RideLiftSummary | null }): boolean {
  return Boolean(ride.lift) || hasLiftAdjustedClimb(ride);
}

/**
 * "Chairlift detected" or "Gondola detected" when every lift that was matched
 * to a mapped line is that kind, otherwise the generic "Lift detected".
 * Segments found from motion alone (null kind) do not change the word.
 */
export function liftTagLabel(kinds: ReadonlyArray<RideLiftKind | null | undefined>): string {
  const known = new Set(kinds.filter((k): k is RideLiftKind => !!k));
  if (known.size === 1) {
    if (known.has('CHAIRLIFT')) return 'Chairlift detected';
    if (known.has('GONDOLA')) return 'Gondola detected';
  }
  return 'Lift detected';
}

/** "3 laps", one per trip up, the way riders count a lift day. */
export function liftLapCount(count: number): string {
  return `${count} ${count === 1 ? 'lap' : 'laps'}`;
}

/** Distinct OSM lift names in the order the rider first rode them. */
export function liftNames(segments: ReadonlyArray<{ liftName?: string | null }>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const s of segments) {
    const name = s.liftName?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
