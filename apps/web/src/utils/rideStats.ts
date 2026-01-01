import { isValid, parseISO } from 'date-fns';
import { MS_PER_DAY, SECONDS_PER_HOUR } from '../constants/dashboard';

/**
 * Parse a date string that may be either a Unix timestamp (ms) or an ISO string
 */
function parseFlexibleDate(dateStr: string): Date {
  // If it's a numeric string (Unix timestamp in ms), convert to number first
  if (/^\d+$/.test(dateStr)) {
    return new Date(Number(dateStr));
  }
  // Otherwise treat as ISO string
  return parseISO(dateStr);
}

export type Timeframe = '7' | '30' | '90' | 'YTD';

export interface RideData {
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
}

export interface RideStats {
  hours: string;
  miles: string;
  climb: string;
}

/**
 * Get the start date for a given timeframe.
 * For relative timeframes (7, 30, 90 days), calculates from now.
 * For YTD, returns January 1 of the current year.
 */
export function getTimeframeStartDate(timeframe: Timeframe, now: Date = new Date()): Date {
  switch (timeframe) {
    case '7':
      return new Date(now.getTime() - 7 * MS_PER_DAY);
    case '30':
      return new Date(now.getTime() - 30 * MS_PER_DAY);
    case '90':
      return new Date(now.getTime() - 90 * MS_PER_DAY);
    case 'YTD':
      return new Date(now.getFullYear(), 0, 1);
  }
}

/**
 * Filter rides to those within a given time window.
 */
export function filterRidesByDate(rides: RideData[], startDate: Date): RideData[] {
  return rides.filter((ride) => {
    if (!ride.startTime) return false;
    const rideDate = parseFlexibleDate(ride.startTime);
    return isValid(rideDate) && rideDate >= startDate;
  });
}

/**
 * Calculate aggregated statistics for a set of rides.
 */
export function calculateRideStats(rides: RideData[]): RideStats {
  const totalSeconds = rides.reduce(
    (sum, ride) => sum + (ride.durationSeconds ?? 0),
    0
  );
  const totalMiles = rides.reduce(
    (sum, ride) => sum + (ride.distanceMiles ?? 0),
    0
  );
  const totalClimb = rides.reduce(
    (sum, ride) => sum + (ride.elevationGainFeet ?? 0),
    0
  );

  return {
    hours: (totalSeconds / SECONDS_PER_HOUR).toFixed(1),
    miles: Math.round(totalMiles).toLocaleString(),
    climb: Math.round(totalClimb).toLocaleString(),
  };
}
