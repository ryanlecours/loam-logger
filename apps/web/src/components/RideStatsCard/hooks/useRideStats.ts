import { useMemo } from 'react';
import type { Ride } from '../../../models/Ride';
import type {
  PresetTimeframe,
  RideStats,
  RideStatsByTimeframe,
  RideCountStats,
  TrendStats,
  HeartRateStats,
  LocationStats,
  LocationBreakdown,
  BikeTimeData,
  PersonalRecord,
} from '../types';

const DAYS_MS = 24 * 60 * 60 * 1000;
const SECONDS_TO_HOURS = 1 / 3600;
const PRESET_TIMEFRAMES: PresetTimeframe[] = ['1w', '1m', '3m', 'YTD'];

// Parse startTime to milliseconds
const parseStartTime = (value: Ride['startTime']): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num < 1e12 ? num * 1000 : num;
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// Build bike name from bike data
const toBikeName = (bike: BikeSummary): string => {
  const nickname = bike.nickname?.trim();
  const fallback = `${bike.manufacturer ?? ''} ${bike.model ?? ''}`.trim();
  return nickname || fallback || 'Bike';
};

// Build map of bike ID to name
export const buildBikeNameMap = (bikes: BikeSummary[]): Map<string, string> => {
  const map = new Map<string, string>();
  bikes.forEach((bike) => map.set(bike.id, toBikeName(bike)));
  return map;
};

type BikeSummary = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

interface UseRideStatsOptions {
  rides: Ride[];
  bikeNameMap: Map<string, string>;
}

export function useRideStats({ rides, bikeNameMap }: UseRideStatsOptions): RideStatsByTimeframe {
  return useMemo(
    () => computeAllStats(rides, bikeNameMap),
    [rides, bikeNameMap]
  );
}

/** Compute stats for a given set of rides without timeframe filtering */
export function useRideStatsForRides({ rides, bikeNameMap }: UseRideStatsOptions): RideStats {
  return useMemo(
    () => computeStatsForTimeframe(rides, bikeNameMap, rides),
    [rides, bikeNameMap]
  );
}

/** Compute stats for a specific year */
export function useRideStatsForYear(
  rides: Ride[],
  bikeNameMap: Map<string, string>,
  year: number
): RideStats {
  return useMemo(() => {
    // Use Date.UTC to create UTC timestamps to avoid timezone issues
    const yearStart = Date.UTC(year, 0, 1, 0, 0, 0, 0);
    const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59, 999);

    const filteredRides = rides.filter((r) => {
      const ts = parseStartTime(r.startTime);
      return ts !== null && ts >= yearStart && ts <= yearEnd;
    });

    return computeStatsForTimeframe(filteredRides, bikeNameMap, rides);
  }, [rides, bikeNameMap, year]);
}

/** Get unique years that have ride data */
export function getYearsWithRides(rides: Ride[]): number[] {
  const years = new Set<number>();
  const currentYear = new Date().getFullYear();

  for (const ride of rides) {
    const ts = parseStartTime(ride.startTime);
    if (ts !== null) {
      const year = new Date(ts).getFullYear();
      // Only include past years (not current year, which is covered by YTD)
      if (year < currentYear) {
        years.add(year);
      }
    }
  }

  // Sort descending (most recent first)
  return Array.from(years).sort((a, b) => b - a);
}

function computeAllStats(
  rides: Ride[],
  bikeNameMap: Map<string, string>
): RideStatsByTimeframe {
  const now = Date.now();

  const thresholds: Record<PresetTimeframe, number> = {
    '1w': now - 7 * DAYS_MS,
    '1m': now - 30 * DAYS_MS,
    '3m': now - 90 * DAYS_MS,
    'YTD': new Date(new Date().getFullYear(), 0, 1).getTime(),
  };

  const result = {} as RideStatsByTimeframe;

  for (const tf of PRESET_TIMEFRAMES) {
    const threshold = thresholds[tf];
    const filteredRides = rides.filter((r) => {
      const ts = parseStartTime(r.startTime);
      return ts !== null && ts >= threshold;
    });

    result[tf] = computeStatsForTimeframe(filteredRides, bikeNameMap, rides);
  }

  return result;
}

function computeStatsForTimeframe(
  filteredRides: Ride[],
  bikeNameMap: Map<string, string>,
  allRides: Ride[]
): RideStats {
  // Primary metrics
  let totalDistance = 0;
  let totalElevation = 0;
  let totalSeconds = 0;
  const bikeHours = new Map<string, number>();

  for (const ride of filteredRides) {
    const distance = Math.max(ride.distanceMiles ?? 0, 0);
    const elevation = Math.max(ride.elevationGainFeet ?? 0, 0);
    const seconds = Math.max(ride.durationSeconds ?? 0, 0);

    totalDistance += distance;
    totalElevation += elevation;
    totalSeconds += seconds;

    const bikeLabel =
      (ride.bikeId ? bikeNameMap.get(ride.bikeId) : null) ?? 'Unassigned';
    bikeHours.set(bikeLabel, (bikeHours.get(bikeLabel) ?? 0) + seconds * SECONDS_TO_HOURS);
  }

  const totalHours = totalSeconds * SECONDS_TO_HOURS;

  // Bike time breakdown with percentages
  const bikeTime: BikeTimeData[] = Array.from(bikeHours.entries())
    .map(([name, hours]) => ({
      name,
      hours: Number(hours.toFixed(1)),
      percentage: totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0,
    }))
    .sort((a, b) => b.hours - a.hours);

  return {
    distance: Number(totalDistance.toFixed(1)),
    elevation: Math.round(totalElevation),
    hours: Number(totalHours.toFixed(1)),
    bikeTime,
    rideCount: computeRideCountStats(filteredRides),
    trends: computeTrendStats(filteredRides, allRides),
    heartRate: computeHeartRateStats(filteredRides),
    locations: computeLocationStats(filteredRides),
  };
}

function computeRideCountStats(rides: Ride[]): RideCountStats {
  const totalRides = rides.length;
  if (totalRides === 0) {
    return {
      totalRides: 0,
      avgDistancePerRide: 0,
      avgElevationPerRide: 0,
      avgDurationMinutes: 0,
    };
  }

  const totalDistance = rides.reduce((sum, r) => sum + (r.distanceMiles ?? 0), 0);
  const totalElevation = rides.reduce((sum, r) => sum + (r.elevationGainFeet ?? 0), 0);
  const totalSeconds = rides.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0);

  return {
    totalRides,
    avgDistancePerRide: Number((totalDistance / totalRides).toFixed(1)),
    avgElevationPerRide: Math.round(totalElevation / totalRides),
    avgDurationMinutes: Math.round(totalSeconds / 60 / totalRides),
  };
}

function computeTrendStats(filteredRides: Ride[], allRides: Ride[]): TrendStats {
  const now = Date.now();
  const oneWeekAgo = now - 7 * DAYS_MS;
  const twoWeeksAgo = now - 14 * DAYS_MS;

  // Get rides from this week and last week (from all rides, not just filtered)
  const thisWeekRides = allRides.filter((r) => {
    const ts = parseStartTime(r.startTime);
    return ts !== null && ts >= oneWeekAgo;
  });

  const lastWeekRides = allRides.filter((r) => {
    const ts = parseStartTime(r.startTime);
    return ts !== null && ts >= twoWeeksAgo && ts < oneWeekAgo;
  });

  const thisWeekDistance = thisWeekRides.reduce((sum, r) => sum + (r.distanceMiles ?? 0), 0);
  const lastWeekDistance = lastWeekRides.reduce((sum, r) => sum + (r.distanceMiles ?? 0), 0);

  const weekOverWeekDistance =
    lastWeekDistance > 0
      ? Math.round(((thisWeekDistance - lastWeekDistance) / lastWeekDistance) * 100)
      : null;

  const weekOverWeekRides =
    lastWeekRides.length > 0
      ? Math.round(((thisWeekRides.length - lastWeekRides.length) / lastWeekRides.length) * 100)
      : null;

  const { currentStreak, longestStreak } = computeStreaks(allRides);
  const personalRecords = computePersonalRecords(filteredRides);

  return {
    weekOverWeekDistance,
    weekOverWeekRides,
    currentStreak,
    longestStreak,
    personalRecords,
  };
}

function computeStreaks(rides: Ride[]): { currentStreak: number; longestStreak: number } {
  if (rides.length === 0) return { currentStreak: 0, longestStreak: 0 };

  // Get unique dates (normalized to date string)
  const rideDates = new Set(
    rides
      .map((r) => parseStartTime(r.startTime))
      .filter((t): t is number => t !== null)
      .map((t) => new Date(t).toDateString())
  );

  if (rideDates.size === 0) return { currentStreak: 0, longestStreak: 0 };

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - DAYS_MS).toDateString();

  // Sort dates descending (most recent first)
  const sortedDates = Array.from(rideDates).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  let longestStreak = 1;
  let currentRunStreak = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(sortedDates[i - 1]).getTime();
    const currDate = new Date(sortedDates[i]).getTime();
    const diffDays = (prevDate - currDate) / DAYS_MS;

    if (Math.abs(diffDays - 1) < 0.1) {
      currentRunStreak++;
      longestStreak = Math.max(longestStreak, currentRunStreak);
    } else {
      currentRunStreak = 1;
    }
  }

  // Current streak only counts if there's a ride today or yesterday
  const hasRecentRide = rideDates.has(today) || rideDates.has(yesterday);
  let currentStreak = 0;

  if (hasRecentRide) {
    currentStreak = 1;
    const startDate = rideDates.has(today) ? today : yesterday;
    let checkDate = new Date(startDate);

    while (true) {
      checkDate = new Date(checkDate.getTime() - DAYS_MS);
      if (rideDates.has(checkDate.toDateString())) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  return { currentStreak, longestStreak };
}

function computePersonalRecords(rides: Ride[]): PersonalRecord[] {
  if (rides.length === 0) return [];

  const records: PersonalRecord[] = [];

  // Longest ride by distance
  const longestByDistance = rides.reduce(
    (max, r) => ((r.distanceMiles ?? 0) > (max.distanceMiles ?? 0) ? r : max),
    rides[0]
  );

  if ((longestByDistance.distanceMiles ?? 0) > 0) {
    records.push({
      type: 'longest_ride',
      value: longestByDistance.distanceMiles ?? 0,
      date: longestByDistance.startTime,
      rideId: longestByDistance.id,
    });
  }

  // Most elevation
  const mostElevation = rides.reduce(
    (max, r) => ((r.elevationGainFeet ?? 0) > (max.elevationGainFeet ?? 0) ? r : max),
    rides[0]
  );

  if ((mostElevation.elevationGainFeet ?? 0) > 0) {
    records.push({
      type: 'most_elevation',
      value: mostElevation.elevationGainFeet ?? 0,
      date: mostElevation.startTime,
      rideId: mostElevation.id,
    });
  }

  // Longest duration
  const longestDuration = rides.reduce(
    (max, r) => ((r.durationSeconds ?? 0) > (max.durationSeconds ?? 0) ? r : max),
    rides[0]
  );

  if ((longestDuration.durationSeconds ?? 0) > 0) {
    records.push({
      type: 'longest_duration',
      value: longestDuration.durationSeconds ?? 0,
      date: longestDuration.startTime,
      rideId: longestDuration.id,
    });
  }

  return records;
}

function computeHeartRateStats(rides: Ride[]): HeartRateStats {
  const ridesWithHr = rides.filter((r) => r.averageHr != null && r.averageHr > 0);

  if (ridesWithHr.length === 0) {
    return {
      averageHr: null,
      maxHr: null,
      ridesWithHr: 0,
      totalRides: rides.length,
    };
  }

  const hrValues = ridesWithHr.map((r) => r.averageHr!);
  const avgHr = Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length);
  const maxHr = Math.max(...hrValues);

  return {
    averageHr: avgHr,
    maxHr,
    ridesWithHr: ridesWithHr.length,
    totalRides: rides.length,
  };
}

function computeLocationStats(rides: Ride[]): LocationStats {
  const locationMap = new Map<string, { count: number; hours: number }>();
  const trailSystemMap = new Map<string, { count: number; hours: number }>();

  let totalHours = 0;

  for (const ride of rides) {
    const hours = (ride.durationSeconds ?? 0) * SECONDS_TO_HOURS;
    totalHours += hours;

    if (ride.location?.trim()) {
      const loc = ride.location.trim();
      const existing = locationMap.get(loc) || { count: 0, hours: 0 };
      locationMap.set(loc, { count: existing.count + 1, hours: existing.hours + hours });
    }

    if (ride.trailSystem?.trim()) {
      const trail = ride.trailSystem.trim();
      const existing = trailSystemMap.get(trail) || { count: 0, hours: 0 };
      trailSystemMap.set(trail, { count: existing.count + 1, hours: existing.hours + hours });
    }
  }

  const toBreakdown = (
    map: Map<string, { count: number; hours: number }>
  ): LocationBreakdown[] =>
    Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        rideCount: data.count,
        totalHours: Number(data.hours.toFixed(1)),
        percentage: totalHours > 0 ? Math.round((data.hours / totalHours) * 100) : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours)
      .slice(0, 5); // Top 5

  return {
    topLocations: toBreakdown(locationMap),
    topTrailSystems: toBreakdown(trailSystemMap),
  };
}
