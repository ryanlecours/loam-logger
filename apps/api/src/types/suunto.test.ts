import {
  SUUNTO_CYCLING_ACTIVITY_IDS,
  isSuuntoCyclingActivity,
  getSuuntoRideType,
} from './suunto';

describe('SUUNTO_CYCLING_ACTIVITY_IDS', () => {
  it('includes road, MTB, and indoor cycling', () => {
    expect(SUUNTO_CYCLING_ACTIVITY_IDS).toEqual([2, 10, 37]);
  });
});

describe('isSuuntoCyclingActivity', () => {
  it.each([2, 10, 37])('returns true for cycling activity id %i', (id) => {
    expect(isSuuntoCyclingActivity(id)).toBe(true);
  });

  it.each([
    [0, 'walking'],
    [1, 'running'],
    [11, 'hiking'],
    [21, 'swimming'],
    [22, 'trail running'],
    [31, 'skiing'],
    [47, 'triathlon'],
    [9999, 'unknown future id'],
  ])('returns false for non-cycling activity id %i (%s)', (id) => {
    expect(isSuuntoCyclingActivity(id)).toBe(false);
  });
});

describe('getSuuntoRideType', () => {
  it('returns "Mountain Bike" for activityId 10', () => {
    expect(getSuuntoRideType(10)).toBe('Mountain Bike');
  });

  it('returns "Indoor Cycling" for activityId 37', () => {
    expect(getSuuntoRideType(37)).toBe('Indoor Cycling');
  });

  it('returns "Cycling" for activityId 2', () => {
    expect(getSuuntoRideType(2)).toBe('Cycling');
  });

  it('falls back to "Cycling" for unknown ids (defensive)', () => {
    expect(getSuuntoRideType(9999)).toBe('Cycling');
  });
});
