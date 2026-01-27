export type RideSource = 'strava' | 'garmin' | 'whoop' | 'manual';

export interface RideWithSource {
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  whoopWorkoutId?: string | null;
}

/**
 * Determines the source of a ride based on activity IDs.
 * Priority: Strava > Garmin > WHOOP > Manual
 */
export function getRideSource(ride: RideWithSource): RideSource {
  if (ride.stravaActivityId) return 'strava';
  if (ride.garminActivityId) return 'garmin';
  if (ride.whoopWorkoutId) return 'whoop';
  return 'manual';
}

export const SOURCE_LABELS: Record<RideSource, string> = {
  strava: 'Strava',
  garmin: 'Garmin',
  whoop: 'WHOOP',
  manual: 'Manual',
};
