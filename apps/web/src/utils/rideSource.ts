import { formatGarminSource, hasGarminData } from '@loam/shared';

export type RideSource = 'strava' | 'garmin' | 'whoop' | 'suunto' | 'manual';

export interface RideWithSource {
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  whoopWorkoutId?: string | null;
  suuntoWorkoutId?: string | null;
  garminDeviceName?: string | null;
}

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
  if (ride.garminActivityId) sources.push('garmin');
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
  if (source === 'garmin') return formatGarminSource(ride.garminDeviceName);
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
