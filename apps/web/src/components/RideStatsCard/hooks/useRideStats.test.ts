import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useRideStats,
  useRideStatsForRides,
  useRideStatsForYear,
  getYearsWithRides,
  buildBikeNameMap,
} from './useRideStats';
import type { Ride } from '../../../models/Ride';

// Helper to create test rides
const createRide = (overrides: Partial<Ride> = {}): Ride => ({
  id: `ride-${Math.random().toString(36).slice(2)}`,
  startTime: '2024-06-15T12:00:00Z',
  durationSeconds: 3600,
  distanceMiles: 10,
  elevationGainFeet: 500,
  rideType: 'Trail',
  bikeId: null,
  averageHr: null,
  notes: null,
  trailSystem: null,
  location: null,
  stravaActivityId: null,
  garminActivityId: null,
  whoopWorkoutId: null,
  ...overrides,
});

// Helper to create a bike name map
const createBikeNameMap = (bikes: Array<{ id: string; name: string }>): Map<string, string> => {
  const map = new Map<string, string>();
  bikes.forEach(({ id, name }) => map.set(id, name));
  return map;
};

describe('buildBikeNameMap', () => {
  it('creates a map from bike array', () => {
    const bikes = [
      { id: 'bike-1', nickname: 'My Trek', manufacturer: 'Trek', model: 'Slash' },
      { id: 'bike-2', nickname: null, manufacturer: 'Santa Cruz', model: 'Bronson' },
    ];

    const result = buildBikeNameMap(bikes);

    expect(result.get('bike-1')).toBe('My Trek');
    expect(result.get('bike-2')).toBe('Santa Cruz Bronson');
  });

  it('prefers nickname over manufacturer/model', () => {
    const bikes = [
      { id: 'bike-1', nickname: 'Nickname', manufacturer: 'Trek', model: 'Slash' },
    ];

    const result = buildBikeNameMap(bikes);

    expect(result.get('bike-1')).toBe('Nickname');
  });

  it('handles empty nickname with whitespace', () => {
    const bikes = [
      { id: 'bike-1', nickname: '   ', manufacturer: 'Trek', model: 'Slash' },
    ];

    const result = buildBikeNameMap(bikes);

    expect(result.get('bike-1')).toBe('Trek Slash');
  });

  it('returns "Bike" when no name info available', () => {
    const bikes = [
      { id: 'bike-1', nickname: '', manufacturer: '', model: '' },
    ];

    const result = buildBikeNameMap(bikes);

    expect(result.get('bike-1')).toBe('Bike');
  });
});

describe('getYearsWithRides', () => {
  let mockDate: Date;

  beforeEach(() => {
    // Mock current year as 2024
    mockDate = new Date('2024-06-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array for no rides', () => {
    const result = getYearsWithRides([]);
    expect(result).toEqual([]);
  });

  it('excludes current year from results', () => {
    const rides = [
      createRide({ startTime: '2024-03-15T12:00:00Z' }),
      createRide({ startTime: '2024-06-15T12:00:00Z' }),
    ];

    const result = getYearsWithRides(rides);

    expect(result).not.toContain(2024);
  });

  it('includes previous years with rides', () => {
    const rides = [
      createRide({ startTime: '2023-06-15T12:00:00Z' }),
      createRide({ startTime: '2022-03-15T12:00:00Z' }),
      createRide({ startTime: '2024-01-15T12:00:00Z' }), // current year, excluded
    ];

    const result = getYearsWithRides(rides);

    expect(result).toContain(2023);
    expect(result).toContain(2022);
    expect(result).not.toContain(2024);
  });

  it('returns years sorted descending (most recent first)', () => {
    const rides = [
      createRide({ startTime: '2020-06-15T12:00:00Z' }),
      createRide({ startTime: '2023-03-15T12:00:00Z' }),
      createRide({ startTime: '2021-01-15T12:00:00Z' }),
    ];

    const result = getYearsWithRides(rides);

    expect(result).toEqual([2023, 2021, 2020]);
  });

  it('deduplicates years', () => {
    const rides = [
      createRide({ startTime: '2023-01-15T12:00:00Z' }),
      createRide({ startTime: '2023-06-15T12:00:00Z' }),
      createRide({ startTime: '2023-12-15T12:00:00Z' }),
    ];

    const result = getYearsWithRides(rides);

    expect(result).toEqual([2023]);
  });

  it('handles Unix timestamp strings', () => {
    // Using timestamps that are clearly in milliseconds (> 1e12)
    // 1672531200000 = Jan 1, 2023 00:00:00 UTC
    // 1640995200000 = Jan 1, 2022 00:00:00 UTC
    const rides = [
      createRide({ startTime: '1672574400000' }), // Jan 1, 2023 12:00:00 UTC (mid-day to avoid TZ issues)
      createRide({ startTime: '1641038400000' }), // Jan 1, 2022 12:00:00 UTC (mid-day to avoid TZ issues)
    ];

    const result = getYearsWithRides(rides);

    expect(result).toContain(2023);
    expect(result).toContain(2022);
  });

  it('handles invalid dates gracefully', () => {
    const rides = [
      createRide({ startTime: '2023-06-15T12:00:00Z' }),
      createRide({ startTime: 'invalid-date' }),
      createRide({ startTime: '' }),
    ];

    const result = getYearsWithRides(rides);

    expect(result).toEqual([2023]);
  });
});

describe('useRideStats', () => {
  let mockDate: Date;

  beforeEach(() => {
    mockDate = new Date('2024-06-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stats for all preset timeframes', () => {
    const rides = [
      createRide({ startTime: '2024-06-10T12:00:00Z', distanceMiles: 10 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStats({ rides, bikeNameMap })
    );

    expect(result.current).toHaveProperty('1w');
    expect(result.current).toHaveProperty('1m');
    expect(result.current).toHaveProperty('3m');
    expect(result.current).toHaveProperty('YTD');
    expect(result.current).toHaveProperty('ALL');
  });

  it('filters rides correctly for 1 week timeframe', () => {
    const rides = [
      createRide({ startTime: '2024-06-14T12:00:00Z', distanceMiles: 10 }), // Within 1 week
      createRide({ startTime: '2024-06-01T12:00:00Z', distanceMiles: 20 }), // Outside 1 week
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStats({ rides, bikeNameMap })
    );

    expect(result.current['1w'].distance).toBe(10);
    expect(result.current['1m'].distance).toBe(30);
  });

  it('calculates totals correctly', () => {
    const rides = [
      createRide({
        startTime: '2024-06-14T12:00:00Z',
        distanceMiles: 10,
        elevationGainFeet: 1000,
        durationSeconds: 3600,
      }),
      createRide({
        startTime: '2024-06-13T12:00:00Z',
        distanceMiles: 15,
        elevationGainFeet: 1500,
        durationSeconds: 5400,
      }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStats({ rides, bikeNameMap })
    );

    const stats = result.current['1w'];
    expect(stats.distance).toBe(25);
    expect(stats.elevation).toBe(2500);
    expect(stats.hours).toBe(2.5);
  });
});

describe('useRideStatsForRides', () => {
  it('calculates stats for provided rides', () => {
    const rides = [
      createRide({ distanceMiles: 10, elevationGainFeet: 1000, durationSeconds: 3600 }),
      createRide({ distanceMiles: 15, elevationGainFeet: 500, durationSeconds: 1800 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.distance).toBe(25);
    expect(result.current.elevation).toBe(1500);
    expect(result.current.hours).toBe(1.5);
    expect(result.current.rideCount.totalRides).toBe(2);
  });

  it('returns empty stats for no rides', () => {
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides: [], bikeNameMap })
    );

    expect(result.current.distance).toBe(0);
    expect(result.current.elevation).toBe(0);
    expect(result.current.hours).toBe(0);
    expect(result.current.rideCount.totalRides).toBe(0);
  });

  it('calculates bike time breakdown', () => {
    const rides = [
      createRide({ bikeId: 'bike-1', durationSeconds: 3600 }),
      createRide({ bikeId: 'bike-1', durationSeconds: 3600 }),
      createRide({ bikeId: 'bike-2', durationSeconds: 3600 }),
      createRide({ bikeId: null, durationSeconds: 3600 }),
    ];
    const bikeNameMap = createBikeNameMap([
      { id: 'bike-1', name: 'Trek' },
      { id: 'bike-2', name: 'Santa Cruz' },
    ]);

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.bikeTime).toHaveLength(3);
    const trekBike = result.current.bikeTime.find(b => b.name === 'Trek');
    expect(trekBike?.hours).toBe(2);
    expect(trekBike?.percentage).toBe(50);
  });
});

describe('useRideStatsForYear', () => {
  it('filters rides to specific year', () => {
    const rides = [
      createRide({ startTime: '2023-03-15T12:00:00Z', distanceMiles: 10 }),
      createRide({ startTime: '2023-09-15T12:00:00Z', distanceMiles: 15 }),
      createRide({ startTime: '2024-01-15T12:00:00Z', distanceMiles: 20 }),
      createRide({ startTime: '2022-06-15T12:00:00Z', distanceMiles: 5 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForYear(rides, bikeNameMap, 2023)
    );

    expect(result.current.distance).toBe(25); // 10 + 15 from 2023
    expect(result.current.rideCount.totalRides).toBe(2);
  });

  it('includes rides at year boundaries', () => {
    // Use mid-day timestamps to avoid timezone edge cases
    const rides = [
      createRide({ startTime: '2023-01-01T12:00:00Z', distanceMiles: 5 }),
      createRide({ startTime: '2023-12-31T12:00:00Z', distanceMiles: 10 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForYear(rides, bikeNameMap, 2023)
    );

    expect(result.current.distance).toBe(15);
    expect(result.current.rideCount.totalRides).toBe(2);
  });

  it('returns empty stats for year with no rides', () => {
    const rides = [
      createRide({ startTime: '2023-06-15T12:00:00Z', distanceMiles: 10 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForYear(rides, bikeNameMap, 2020)
    );

    expect(result.current.distance).toBe(0);
    expect(result.current.rideCount.totalRides).toBe(0);
  });
});

describe('ride count stats', () => {
  it('calculates averages correctly', () => {
    const rides = [
      createRide({ distanceMiles: 10, elevationGainFeet: 1000, durationSeconds: 3600 }),
      createRide({ distanceMiles: 20, elevationGainFeet: 2000, durationSeconds: 7200 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.rideCount.avgDistancePerRide).toBe(15);
    expect(result.current.rideCount.avgElevationPerRide).toBe(1500);
    expect(result.current.rideCount.avgDurationMinutes).toBe(90);
  });
});

describe('heart rate stats', () => {
  it('calculates heart rate averages', () => {
    const rides = [
      createRide({ averageHr: 140 }),
      createRide({ averageHr: 160 }),
      createRide({ averageHr: null }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.heartRate.averageHr).toBe(150);
    expect(result.current.heartRate.maxHr).toBe(160);
    expect(result.current.heartRate.ridesWithHr).toBe(2);
    expect(result.current.heartRate.totalRides).toBe(3);
  });

  it('returns null for no heart rate data', () => {
    const rides = [
      createRide({ averageHr: null }),
      createRide({ averageHr: null }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.heartRate.averageHr).toBeNull();
    expect(result.current.heartRate.maxHr).toBeNull();
  });
});

describe('location stats', () => {
  it('tracks top locations', () => {
    const rides = [
      createRide({ location: 'Trail A', durationSeconds: 7200 }),
      createRide({ location: 'Trail A', durationSeconds: 3600 }),
      createRide({ location: 'Trail B', durationSeconds: 3600 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.locations.topLocations).toHaveLength(2);
    const trailA = result.current.locations.topLocations.find(l => l.name === 'Trail A');
    expect(trailA?.rideCount).toBe(2);
  });

  it('tracks top trail systems', () => {
    const rides = [
      createRide({ trailSystem: 'System A', durationSeconds: 3600 }),
      createRide({ trailSystem: 'System B', durationSeconds: 7200 }),
    ];
    const bikeNameMap = new Map<string, string>();

    const { result } = renderHook(() =>
      useRideStatsForRides({ rides, bikeNameMap })
    );

    expect(result.current.locations.topTrailSystems).toHaveLength(2);
    // System B has more hours so should be first
    expect(result.current.locations.topTrailSystems[0].name).toBe('System B');
  });
});
