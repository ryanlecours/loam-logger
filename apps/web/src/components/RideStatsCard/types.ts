// Timeframes for ride statistics
// Can be a preset timeframe or a specific year (as a number)
export type Timeframe = '1w' | '1m' | '3m' | 'YTD' | number;

// Bike time breakdown
export interface BikeTimeData {
  name: string;
  hours: number;
  percentage: number;
}

// Ride count and averages
export interface RideCountStats {
  totalRides: number;
  avgDistancePerRide: number;
  avgElevationPerRide: number;
  avgDurationMinutes: number;
}

// Personal records
export interface PersonalRecord {
  type: 'longest_ride' | 'most_elevation' | 'longest_duration';
  value: number;
  date: string;
  rideId: string;
}

// Trends and streaks
export interface TrendStats {
  weekOverWeekDistance: number | null; // percentage change, null if no prior data
  weekOverWeekRides: number | null;
  currentStreak: number; // consecutive days with rides
  longestStreak: number;
  personalRecords: PersonalRecord[];
}

// Heart rate statistics
export interface HeartRateStats {
  averageHr: number | null;
  maxHr: number | null;
  ridesWithHr: number;
  totalRides: number;
}

// Location breakdown item
export interface LocationBreakdown {
  name: string;
  rideCount: number;
  totalHours: number;
  percentage: number;
}

// Location insights
export interface LocationStats {
  topLocations: LocationBreakdown[];
  topTrailSystems: LocationBreakdown[];
}

// Complete ride statistics for a timeframe
export interface RideStats {
  // Primary metrics
  distance: number;
  elevation: number;
  hours: number;

  // Detailed breakdowns
  bikeTime: BikeTimeData[];
  rideCount: RideCountStats;
  trends: TrendStats;
  heartRate: HeartRateStats;
  locations: LocationStats;
}

// Preset timeframe values (excludes year numbers)
export type PresetTimeframe = '1w' | '1m' | '3m' | 'YTD';

// Stats by timeframe (presets only - years are computed on demand)
export type RideStatsByTimeframe = Record<PresetTimeframe, RideStats>;

// Empty stats constant
export const EMPTY_STATS: RideStats = {
  distance: 0,
  elevation: 0,
  hours: 0,
  bikeTime: [],
  rideCount: {
    totalRides: 0,
    avgDistancePerRide: 0,
    avgElevationPerRide: 0,
    avgDurationMinutes: 0,
  },
  trends: {
    weekOverWeekDistance: null,
    weekOverWeekRides: null,
    currentStreak: 0,
    longestStreak: 0,
    personalRecords: [],
  },
  heartRate: {
    averageHr: null,
    maxHr: null,
    ridesWithHr: 0,
    totalRides: 0,
  },
  locations: {
    topLocations: [],
    topTrailSystems: [],
  },
};
