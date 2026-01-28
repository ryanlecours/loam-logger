import { describe, it, expect } from 'vitest';
import { EMPTY_STATS, type Timeframe, type PresetTimeframe, type RideStats } from './types';

describe('Timeframe type', () => {
  it('accepts preset string values', () => {
    const tf1: Timeframe = '1w';
    const tf2: Timeframe = '1m';
    const tf3: Timeframe = '3m';
    const tf4: Timeframe = 'YTD';
    const tf5: Timeframe = 'ALL';

    expect(tf1).toBe('1w');
    expect(tf2).toBe('1m');
    expect(tf3).toBe('3m');
    expect(tf4).toBe('YTD');
    expect(tf5).toBe('ALL');
  });

  it('accepts number values for years', () => {
    const tf: Timeframe = 2023;
    expect(tf).toBe(2023);
  });

  it('can distinguish between preset and year via typeof', () => {
    const preset: Timeframe = 'YTD';
    const year: Timeframe = 2023;

    expect(typeof preset).toBe('string');
    expect(typeof year).toBe('number');
  });
});

describe('PresetTimeframe type', () => {
  it('only accepts preset string values', () => {
    const tf1: PresetTimeframe = '1w';
    const tf2: PresetTimeframe = '1m';
    const tf3: PresetTimeframe = '3m';
    const tf4: PresetTimeframe = 'YTD';
    const tf5: PresetTimeframe = 'ALL';

    expect(tf1).toBe('1w');
    expect(tf2).toBe('1m');
    expect(tf3).toBe('3m');
    expect(tf4).toBe('YTD');
    expect(tf5).toBe('ALL');
  });

  // Note: Cannot test that numbers are rejected at runtime, but TypeScript will catch this
});

describe('EMPTY_STATS', () => {
  it('has zero values for primary metrics', () => {
    expect(EMPTY_STATS.distance).toBe(0);
    expect(EMPTY_STATS.elevation).toBe(0);
    expect(EMPTY_STATS.hours).toBe(0);
  });

  it('has empty arrays for breakdowns', () => {
    expect(EMPTY_STATS.bikeTime).toEqual([]);
    expect(EMPTY_STATS.locations.topLocations).toEqual([]);
    expect(EMPTY_STATS.locations.topTrailSystems).toEqual([]);
    expect(EMPTY_STATS.trends.personalRecords).toEqual([]);
  });

  it('has zero ride count stats', () => {
    expect(EMPTY_STATS.rideCount.totalRides).toBe(0);
    expect(EMPTY_STATS.rideCount.avgDistancePerRide).toBe(0);
    expect(EMPTY_STATS.rideCount.avgElevationPerRide).toBe(0);
    expect(EMPTY_STATS.rideCount.avgDurationMinutes).toBe(0);
  });

  it('has null heart rate values', () => {
    expect(EMPTY_STATS.heartRate.averageHr).toBeNull();
    expect(EMPTY_STATS.heartRate.maxHr).toBeNull();
    expect(EMPTY_STATS.heartRate.ridesWithHr).toBe(0);
    expect(EMPTY_STATS.heartRate.totalRides).toBe(0);
  });

  it('has null trend values', () => {
    expect(EMPTY_STATS.trends.weekOverWeekDistance).toBeNull();
    expect(EMPTY_STATS.trends.weekOverWeekRides).toBeNull();
    expect(EMPTY_STATS.trends.currentStreak).toBe(0);
    expect(EMPTY_STATS.trends.longestStreak).toBe(0);
  });

  it('conforms to RideStats interface', () => {
    // Type assertion to verify structure
    const stats: RideStats = EMPTY_STATS;
    expect(stats).toBeDefined();
  });
});
