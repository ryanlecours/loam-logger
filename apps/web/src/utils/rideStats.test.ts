import { describe, it, expect } from 'vitest';
import {
  getTimeframeStartDate,
  filterRidesByDate,
  calculateRideStats,
  type RideData,
} from './rideStats';

describe('getTimeframeStartDate', () => {
  // Use a fixed reference date for consistent testing
  const referenceDate = new Date('2024-06-15T12:00:00Z');

  it('returns 7 days before reference date', () => {
    const result = getTimeframeStartDate('7', referenceDate);
    const expected = new Date('2024-06-08T12:00:00Z');

    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns 30 days before reference date', () => {
    const result = getTimeframeStartDate('30', referenceDate);
    const expected = new Date('2024-05-16T12:00:00Z');

    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns 90 days before reference date', () => {
    const result = getTimeframeStartDate('90', referenceDate);
    const expected = new Date('2024-03-17T12:00:00Z');

    expect(result.getTime()).toBe(expected.getTime());
  });

  it('returns January 1 of the same year for YTD', () => {
    const result = getTimeframeStartDate('YTD', referenceDate);

    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(1);
  });

  it('handles year boundary for YTD', () => {
    const janFirst = new Date('2024-01-01T12:00:00Z');
    const result = getTimeframeStartDate('YTD', janFirst);

    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });

  it('uses current date when no reference provided', () => {
    const now = new Date();
    const result = getTimeframeStartDate('7');

    // Should be approximately 7 days ago (within 1 second)
    const expectedTime = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(result.getTime() - expectedTime)).toBeLessThan(1000);
  });
});

describe('filterRidesByDate', () => {
  const createRide = (startTime: string, overrides: Partial<RideData> = {}): RideData => ({
    startTime,
    durationSeconds: 3600,
    distanceMeters: 16093,
    elevationGainMeters: 500,
    ...overrides,
  });

  it('returns empty array for empty input', () => {
    const startDate = new Date('2024-01-01');
    expect(filterRidesByDate([], startDate)).toEqual([]);
  });

  it('filters out rides before start date', () => {
    const rides = [
      createRide('2024-01-15T12:00:00Z'), // Before
      createRide('2024-02-15T12:00:00Z'), // After
    ];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe('2024-02-15T12:00:00Z');
  });

  it('includes rides on start date', () => {
    const rides = [createRide('2024-02-01T00:00:00Z')];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(1);
  });

  it('includes rides after start date', () => {
    const rides = [
      createRide('2024-02-15T12:00:00Z'),
      createRide('2024-03-01T12:00:00Z'),
    ];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(2);
  });

  it('filters out rides with missing startTime', () => {
    const rides = [
      createRide('2024-02-15T12:00:00Z'),
      { ...createRide('2024-02-16T12:00:00Z'), startTime: '' },
    ];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(1);
  });

  it('filters out rides with invalid date strings', () => {
    const rides = [
      createRide('2024-02-15T12:00:00Z'),
      createRide('not-a-valid-date'),
    ];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(1);
  });

  it('handles Unix timestamp strings (milliseconds)', () => {
    const rides = [
      createRide('1704067200000'), // Jan 1, 2024 00:00:00 UTC
      createRide('1706745600000'), // Feb 1, 2024 00:00:00 UTC
      createRide('1709251200000'), // Mar 1, 2024 00:00:00 UTC
    ];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(2); // Feb and Mar
  });

  it('handles mixed ISO and timestamp formats', () => {
    const rides = [
      createRide('2024-02-15T12:00:00Z'), // ISO format
      createRide('1709251200000'), // Mar 1, 2024 as timestamp
    ];
    const startDate = new Date('2024-02-01T00:00:00Z');

    const result = filterRidesByDate(rides, startDate);

    expect(result).toHaveLength(2);
  });
});

describe('calculateRideStats', () => {
  const createRide = (overrides: Partial<RideData> = {}): RideData => ({
    startTime: '2024-02-15T12:00:00Z',
    durationSeconds: 3600,
    distanceMeters: 16093,
    elevationGainMeters: 500,
    ...overrides,
  });

  it('returns zeros for empty array', () => {
    const result = calculateRideStats([]);

    expect(result.hours).toBe('0.0');
    expect(result.distance).toBe('0');
    expect(result.climb).toBe('0');
  });

  it('calculates hours from durationSeconds', () => {
    const rides = [
      createRide({ durationSeconds: 3600 }), // 1 hour
      createRide({ durationSeconds: 1800 }), // 0.5 hours
    ];

    const result = calculateRideStats(rides);

    expect(result.hours).toBe('1.5');
  });

  it('formats hours with one decimal place', () => {
    const rides = [createRide({ durationSeconds: 4000 })]; // 1.111... hours

    const result = calculateRideStats(rides);

    expect(result.hours).toBe('1.1');
  });

  it('sums distance and converts meters to miles', () => {
    const rides = [
      createRide({ distanceMeters: 16093.44 }), // 10 mi
      createRide({ distanceMeters: 24140.16 }), // 15 mi
    ];

    const result = calculateRideStats(rides);

    // 25 miles total
    expect(result.distance).toBe('25');
  });

  it('formats miles with locale separators', () => {
    const rides = [
      createRide({ distanceMeters: 1609344 }), // 1000 mi
      createRide({ distanceMeters: 804672 }),   // 500 mi
    ];

    const result = calculateRideStats(rides);

    expect(result.distance).toBe('1,500');
  });

  it('sums elevation gain and converts meters to feet', () => {
    const rides = [
      createRide({ elevationGainMeters: 304.8 }),  // ~1000 ft
      createRide({ elevationGainMeters: 762 }),     // ~2500 ft
    ];

    const result = calculateRideStats(rides);

    expect(result.climb).toBe('3,500');
  });

  it('handles null/undefined values with defaults', () => {
    const rides = [
      {
        startTime: '2024-02-15T12:00:00Z',
        durationSeconds: null as unknown as number,
        distanceMeters: undefined as unknown as number,
        elevationGainMeters: null as unknown as number,
      },
      createRide({ durationSeconds: 3600, distanceMeters: 16093.44, elevationGainMeters: 152.4 }),
    ];

    const result = calculateRideStats(rides);

    expect(result.hours).toBe('1.0');
    expect(result.distance).toBe('10');
    expect(result.climb).toBe('500');
  });

  it('handles large values', () => {
    const rides = [
      createRide({ durationSeconds: 360000, distanceMeters: 16093440, elevationGainMeters: 30480 }),
    ];

    const result = calculateRideStats(rides);

    expect(result.hours).toBe('100.0');
    expect(result.distance).toBe('10,000');
    expect(result.climb).toBe('100,000');
  });
});
