export type RideSource = 'strava' | 'garmin' | 'manual';

export interface RideWithSource {
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

/**
 * Determines the source of a ride based on activity IDs.
 * Priority: Strava > Garmin > Manual
 */
export function getRideSource(ride: RideWithSource): RideSource {
  if (ride.stravaActivityId) return 'strava';
  if (ride.garminActivityId) return 'garmin';
  return 'manual';
}

export const SOURCE_LABELS: Record<RideSource, string> = {
  strava: 'Strava',
  garmin: 'Garmin',
  manual: 'Manual',
};
