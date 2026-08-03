import { formatGarminSource, garminSourceDevice, hasGarminData } from '@loam/shared';

export type RideSource = 'strava' | 'garmin' | 'whoop' | 'suunto' | 'manual';

// A type alias, not an interface: hasGarminData/stravaRecordingDevice in
// @loam/shared accept an index-signatured object, and an interface is not
// assignable to that (it stays open to declaration merging) while a sealed type
// alias is. See TS "index signature is missing in type" for the rationale.
export type RideWithSource = {
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  whoopWorkoutId?: string | null;
  suuntoWorkoutId?: string | null;
  garminDeviceName?: string | null;
  stravaDeviceName?: string | null;
};

/**
 * The single source to show when a UI can only show one.
 * Priority: Strava > Garmin > WHOOP > Suunto > Manual
 *
 * Do NOT use this to decide whether to render Garmin attribution — a ride
 * matched across providers ranks as Strava here while still containing Garmin
 * device-sourced data, and the Garmin API Brand Guidelines require attribution
 * wherever that data is present. Use getRideSources() or hasGarminData().
 */
export function getRideSource(ride: RideWithSource): RideSource {
  if (ride.stravaActivityId) return 'strava';
  if (ride.garminActivityId) return 'garmin';
  if (ride.whoopWorkoutId) return 'whoop';
  if (ride.suuntoWorkoutId) return 'suunto';
  return 'manual';
}

/**
 * Every provider that contributed data to this ride, in display order.
 * Cross-provider rides (deduped or matched) return more than one, so each
 * contributing source can be attributed rather than only the top-ranked one.
 */
export function getRideSources(ride: RideWithSource): RideSource[] {
  const sources: RideSource[] = [];
  if (ride.stravaActivityId) sources.push('strava');
  // Garmin is attributed wherever its device-sourced data is present, including
  // a ride recorded on a Garmin device but imported via Strava (hasGarminData
  // keys on garminActivityId OR a Garmin stravaDeviceName). A cross-provider
  // ride therefore carries both a Strava and a Garmin badge.
  if (hasGarminData(ride)) sources.push('garmin');
  if (ride.whoopWorkoutId) sources.push('whoop');
  if (ride.suuntoWorkoutId) sources.push('suunto');
  return sources.length ? sources : ['manual'];
}

/**
 * Display label for one of a ride's sources. Garmin resolves to
 * "Garmin [device model]" as its guidelines require; every other provider
 * uses its plain name.
 */
export function getRideSourceLabel(ride: RideWithSource, source: RideSource): string {
  // Resolve the Garmin device from whichever source carries it: Garmin's own
  // reported model for a native Garmin ride, or Strava's device_name for a ride
  // recorded on a Garmin device and imported via Strava. Falls back to plain
  // "Garmin" when no model is known.
  if (source === 'garmin') return formatGarminSource(garminSourceDevice(ride));
  return SOURCE_LABELS[source];
}

/**
 * Generic provider names. Correct for filters, dropdowns and settings, where
 * the label names a platform rather than attributing a specific ride's data.
 * For per-ride attribution use getRideSourceLabel().
 */
export const SOURCE_LABELS: Record<RideSource, string> = {
  strava: 'Strava',
  garmin: 'Garmin',
  whoop: 'WHOOP',
  suunto: 'Suunto',
  manual: 'Manual',
};

export { hasGarminData };
