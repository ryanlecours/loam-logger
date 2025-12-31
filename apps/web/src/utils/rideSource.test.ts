import { describe, it, expect } from 'vitest';
import { getRideSource, SOURCE_LABELS, type RideWithSource } from './rideSource';

describe('getRideSource', () => {
  it('returns "strava" when stravaActivityId is present', () => {
    const ride: RideWithSource = {
      stravaActivityId: '123456',
      garminActivityId: null,
    };

    expect(getRideSource(ride)).toBe('strava');
  });

  it('returns "garmin" when garminActivityId is present and no strava', () => {
    const ride: RideWithSource = {
      stravaActivityId: null,
      garminActivityId: 'abc123',
    };

    expect(getRideSource(ride)).toBe('garmin');
  });

  it('returns "manual" when no activity IDs are present', () => {
    const ride: RideWithSource = {
      stravaActivityId: null,
      garminActivityId: null,
    };

    expect(getRideSource(ride)).toBe('manual');
  });

  it('returns "strava" when both stravaActivityId and garminActivityId are present (strava priority)', () => {
    const ride: RideWithSource = {
      stravaActivityId: '123456',
      garminActivityId: 'abc123',
    };

    expect(getRideSource(ride)).toBe('strava');
  });

  it('returns "manual" when both are undefined', () => {
    const ride: RideWithSource = {};

    expect(getRideSource(ride)).toBe('manual');
  });

  it('returns "manual" when both are empty strings', () => {
    const ride: RideWithSource = {
      stravaActivityId: '',
      garminActivityId: '',
    };

    expect(getRideSource(ride)).toBe('manual');
  });

  it('handles stravaActivityId with truthy value', () => {
    const ride: RideWithSource = {
      stravaActivityId: '0', // truthy string
      garminActivityId: null,
    };

    expect(getRideSource(ride)).toBe('strava');
  });

  it('handles garminActivityId with truthy value', () => {
    const ride: RideWithSource = {
      stravaActivityId: null,
      garminActivityId: '0', // truthy string
    };

    expect(getRideSource(ride)).toBe('garmin');
  });
});

describe('SOURCE_LABELS', () => {
  it('has correct label for strava', () => {
    expect(SOURCE_LABELS.strava).toBe('Strava');
  });

  it('has correct label for garmin', () => {
    expect(SOURCE_LABELS.garmin).toBe('Garmin');
  });

  it('has correct label for manual', () => {
    expect(SOURCE_LABELS.manual).toBe('Manual');
  });
});
