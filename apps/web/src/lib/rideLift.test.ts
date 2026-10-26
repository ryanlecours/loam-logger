import { describe, it, expect } from 'vitest';
import {
  hasLiftAdjustedClimb,
  liftLapCount,
  liftNames,
  filterRidesByLift,
  LIFT_FILTER_OPTIONS,
  liftTagLabel,
  rideClimbMeters,
  showsLiftData,
} from './rideLift';

describe('rideLift', () => {
  describe('rideClimbMeters', () => {
    it('shows the counted climb when the server sent one', () => {
      expect(rideClimbMeters({ elevationGainMeters: 2000, countedElevationGainMeters: 500 })).toBe(500);
      expect(rideClimbMeters({ elevationGainMeters: 2000, countedElevationGainMeters: 0 })).toBe(0);
    });

    it('falls back to the recorded climb', () => {
      expect(rideClimbMeters({ elevationGainMeters: 800 })).toBe(800);
      expect(rideClimbMeters({ elevationGainMeters: 800, countedElevationGainMeters: null })).toBe(800);
    });
  });

  describe('hasLiftAdjustedClimb', () => {
    it('is true only when a lift lowered the shown climb', () => {
      expect(hasLiftAdjustedClimb({ elevationGainMeters: 2000, countedElevationGainMeters: 500 })).toBe(true);
      expect(hasLiftAdjustedClimb({ elevationGainMeters: 2000, countedElevationGainMeters: 2000 })).toBe(false);
      expect(hasLiftAdjustedClimb({ elevationGainMeters: 2000 })).toBe(false);
    });
  });

  describe('showsLiftData', () => {
    const lift = { elevationGainMeters: 400, countElevation: true, segments: [{ kind: 'CHAIRLIFT' as const }] };

    it('is true for a ride with a lift tag, even when its climb counts', () => {
      expect(showsLiftData({ elevationGainMeters: 2000, countedElevationGainMeters: 2000, lift })).toBe(true);
    });

    it('is true for a lift-adjusted climb', () => {
      expect(showsLiftData({ elevationGainMeters: 2000, countedElevationGainMeters: 500 })).toBe(true);
    });

    it('is false for a ride with no lift', () => {
      expect(showsLiftData({ elevationGainMeters: 2000, countedElevationGainMeters: 2000, lift: null })).toBe(false);
      expect(showsLiftData({ elevationGainMeters: 2000 })).toBe(false);
    });
  });

  describe('filterRidesByLift', () => {
    const lift = { elevationGainMeters: 400, countElevation: false, segments: [{ kind: 'CHAIRLIFT' as const }] };
    const rides = [
      { id: 'a', lift },
      { id: 'b', lift: null },
      { id: 'c' },
      { id: 'd', lift },
    ];

    it('keeps every ride for "all", as a new array', () => {
      const out = filterRidesByLift(rides, 'all');
      expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(out).not.toBe(rides);
    });

    it('keeps rides with a lift, in order', () => {
      expect(filterRidesByLift(rides, 'lift').map((r) => r.id)).toEqual(['a', 'd']);
    });

    it('keeps rides without one, including rides the cache holds without the field', () => {
      expect(filterRidesByLift(rides, 'noLift').map((r) => r.id)).toEqual(['b', 'c']);
    });

    it('offers all three choices, "All rides" first', () => {
      expect(LIFT_FILTER_OPTIONS.map((o) => o.value)).toEqual(['all', 'lift', 'noLift']);
    });
  });

  describe('liftTagLabel', () => {
    it('names the kind when every matched lift agrees', () => {
      expect(liftTagLabel(['CHAIRLIFT', 'CHAIRLIFT', null])).toBe('Chairlift detected');
      expect(liftTagLabel(['GONDOLA'])).toBe('Gondola detected');
    });

    it('falls back to "Lift" for mixed, surface or unmatched lifts', () => {
      expect(liftTagLabel(['CHAIRLIFT', 'GONDOLA'])).toBe('Lift detected');
      expect(liftTagLabel(['OTHER'])).toBe('Lift detected');
      expect(liftTagLabel([null, null])).toBe('Lift detected');
      expect(liftTagLabel([])).toBe('Lift detected');
    });
  });

  it('counts laps', () => {
    expect(liftLapCount(1)).toBe('1 lap');
    expect(liftLapCount(4)).toBe('4 laps');
  });

  it('lists distinct names in ride order, skipping unnamed lifts', () => {
    expect(
      liftNames([
        { liftName: 'Garbanzo Express' },
        { liftName: null },
        { liftName: 'Fitzsimmons Express' },
        { liftName: 'Garbanzo Express' },
        { liftName: '  ' },
      ])
    ).toEqual(['Garbanzo Express', 'Fitzsimmons Express']);
  });
});
