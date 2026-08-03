import { describe, it, expect } from 'vitest';
import {
  getRideSource,
  getRideSources,
  getRideSourceLabel,
  hasGarminData,
  SOURCE_LABELS,
  type RideWithSource,
} from './rideSource';

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

  it('returns "suunto" when only suuntoWorkoutId is present', () => {
    const ride: RideWithSource = {
      stravaActivityId: null,
      garminActivityId: null,
      whoopWorkoutId: null,
      suuntoWorkoutId: 'suunto-key-abc',
    };

    expect(getRideSource(ride)).toBe('suunto');
  });

  it('deprioritizes Suunto behind Strava/Garmin/WHOOP', () => {
    const ride: RideWithSource = {
      stravaActivityId: null,
      garminActivityId: null,
      whoopWorkoutId: 'whoop-uuid',
      suuntoWorkoutId: 'suunto-key-abc',
    };

    expect(getRideSource(ride)).toBe('whoop');
  });
});

describe('SOURCE_LABELS', () => {
  it('has correct label for strava', () => {
    expect(SOURCE_LABELS.strava).toBe('Strava');
  });

  it('has correct label for garmin', () => {
    expect(SOURCE_LABELS.garmin).toBe('Garmin');
  });

  it('has correct label for whoop', () => {
    expect(SOURCE_LABELS.whoop).toBe('WHOOP');
  });

  it('has correct label for suunto', () => {
    expect(SOURCE_LABELS.suunto).toBe('Suunto');
  });

  it('has correct label for manual', () => {
    expect(SOURCE_LABELS.manual).toBe('Manual');
  });
});

describe('getRideSources', () => {
  // The reason this exists: getRideSource ranks Strava above Garmin, so a
  // cross-provider ride used to render as Strava-only and suppress Garmin
  // attribution entirely — which the Garmin API Brand Guidelines require
  // wherever Garmin device-sourced data is present.
  it('returns every contributing provider, not just the top-ranked one', () => {
    const ride: RideWithSource = {
      stravaActivityId: '123456',
      garminActivityId: 'abc123',
    };

    expect(getRideSources(ride)).toEqual(['strava', 'garmin']);
  });

  it('returns a single source for single-provider rides', () => {
    expect(getRideSources({ garminActivityId: 'abc123' })).toEqual(['garmin']);
    expect(getRideSources({ suuntoWorkoutId: 'suunto-key' })).toEqual(['suunto']);
  });

  // Garmin's cross-provider requirement: a Strava ride recorded on a Garmin
  // device must carry a Garmin badge too, even with no garminActivityId.
  it('adds a Garmin source to a Strava ride recorded on a Garmin device', () => {
    expect(
      getRideSources({ stravaActivityId: '123', stravaDeviceName: 'Garmin Edge 840' })
    ).toEqual(['strava', 'garmin']);
  });

  it('does not add Garmin to a Strava ride recorded on non-Garmin hardware', () => {
    expect(
      getRideSources({ stravaActivityId: '123', stravaDeviceName: 'Wahoo ELEMNT' })
    ).toEqual(['strava']);
  });

  it('falls back to manual when no provider contributed', () => {
    expect(getRideSources({})).toEqual(['manual']);
    expect(getRideSources({ stravaActivityId: null, garminActivityId: null })).toEqual([
      'manual',
    ]);
  });
});

describe('getRideSourceLabel', () => {
  it('attributes Garmin rides with the device model', () => {
    const ride: RideWithSource = {
      garminActivityId: 'abc123',
      garminDeviceName: 'edge_840',
    };

    expect(getRideSourceLabel(ride, 'garmin')).toBe('Garmin Edge 840');
  });

  it('falls back to plain "Garmin" when no device was reported', () => {
    expect(getRideSourceLabel({ garminActivityId: 'abc123' }, 'garmin')).toBe('Garmin');
    expect(
      getRideSourceLabel({ garminActivityId: 'abc123', garminDeviceName: null }, 'garmin')
    ).toBe('Garmin');
  });

  // A Strava-imported ride recorded on a Garmin device is attributed with the
  // model Strava reported, even though it has no garminActivityId.
  it('attributes a Garmin-recorded Strava ride with the Strava-reported model', () => {
    expect(
      getRideSourceLabel({ stravaActivityId: '1', stravaDeviceName: 'Garmin Edge 840' }, 'garmin')
    ).toBe('Garmin Edge 840');
  });

  it('leaves other providers on their plain platform name', () => {
    expect(getRideSourceLabel({ stravaActivityId: '1' }, 'strava')).toBe('Strava');
    expect(getRideSourceLabel({ whoopWorkoutId: 'w' }, 'whoop')).toBe('WHOOP');
    expect(getRideSourceLabel({}, 'manual')).toBe('Manual');
  });
});

describe('hasGarminData', () => {
  it('is true for a ride matched across Strava and Garmin', () => {
    expect(hasGarminData({ stravaActivityId: '1', garminActivityId: 'abc' })).toBe(true);
  });

  // The guidelines forbid Garmin branding where Garmin data is not present,
  // so a false negative and a false positive are both compliance failures.
  it('is false for non-Garmin rides', () => {
    expect(hasGarminData({ stravaActivityId: '1' })).toBe(false);
    expect(hasGarminData({})).toBe(false);
  });
});
