import {
  SUUNTO_CYCLING_ACTIVITY_IDS,
  isSuuntoCyclingActivity,
  getSuuntoRideType,
} from './suunto';

describe('SUUNTO_CYCLING_ACTIVITY_IDS', () => {
  it('contains the eight cycling IDs from Suunto\'s official Activities reference', () => {
    // Source: Suunto's Activities.pdf. Entries whose FIT sport is CYCLING or
    // E_BIKING: 2 Cycling, 10 MTB, 52 Indoor cycling, 99 Gravel, 105 E-bike,
    // 106 E-MTB, 109 Hand cycling, 114 Cyclocross.
    expect(SUUNTO_CYCLING_ACTIVITY_IDS).toEqual([2, 10, 52, 99, 105, 106, 109, 114]);
  });
});

describe('isSuuntoCyclingActivity', () => {
  it.each([
    [2, 'cycling'],
    [10, 'mountain biking'],
    [52, 'indoor cycling'],
    [99, 'gravel cycling'],
    [105, 'e-biking'],
    [106, 'e-MTB'],
    [109, 'hand cycling'],
    [114, 'cyclocross'],
  ])('returns true for cycling activity id %i (%s)', (id) => {
    expect(isSuuntoCyclingActivity(id)).toBe(true);
  });

  it.each([
    [0, 'walking'],
    [1, 'running'],
    [11, 'hiking'],
    [21, 'swimming'],
    [22, 'trail running'],
    [30, 'snowboarding'],
    [37, 'baseball (previously misclassified as indoor cycling)'],
    [47, 'cricket'],
    [50, 'ice hockey'],
    [74, 'triathlon'],
    [9999, 'unknown future id'],
  ])('returns false for non-cycling activity id %i (%s)', (id) => {
    expect(isSuuntoCyclingActivity(id)).toBe(false);
  });
});

describe('getSuuntoRideType', () => {
  it('returns "Cycling" for activityId 2', () => {
    expect(getSuuntoRideType(2)).toBe('Cycling');
  });

  it('returns "Mountain Bike" for activityId 10', () => {
    expect(getSuuntoRideType(10)).toBe('Mountain Bike');
  });

  it('returns "Indoor Cycling" for activityId 52', () => {
    expect(getSuuntoRideType(52)).toBe('Indoor Cycling');
  });

  it('returns "Gravel" for activityId 99', () => {
    expect(getSuuntoRideType(99)).toBe('Gravel');
  });

  it('returns "E-Bike" for activityId 105', () => {
    expect(getSuuntoRideType(105)).toBe('E-Bike');
  });

  it('returns "E-Mountain Bike" for activityId 106', () => {
    expect(getSuuntoRideType(106)).toBe('E-Mountain Bike');
  });

  it('returns "Hand Cycling" for activityId 109', () => {
    expect(getSuuntoRideType(109)).toBe('Hand Cycling');
  });

  it('returns "Cyclocross" for activityId 114', () => {
    expect(getSuuntoRideType(114)).toBe('Cyclocross');
  });

  it('falls back to "Cycling" for unknown ids (defensive)', () => {
    expect(getSuuntoRideType(9999)).toBe('Cycling');
  });
});
