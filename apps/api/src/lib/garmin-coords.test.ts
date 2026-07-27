import { extractGarminStartCoords } from './garmin-coords';

describe('extractGarminStartCoords', () => {
  it('reads Garmin\'s real Activity Summary field names (startingLatitudeInDegrees)', () => {
    // Regression guard for the field-name bug: every Garmin ride was landing
    // with null coords — and therefore no weather — because the code read
    // `startLatitudeInDegrees` (no "ing"). Garmin actually sends "starting…".
    expect(
      extractGarminStartCoords({
        startingLatitudeInDegrees: 48.7174,
        startingLongitudeInDegrees: -122.3512,
      })
    ).toEqual({ lat: 48.7174, lng: -122.3512 });
  });

  it('accepts the singular "…Degree" casing seen in Garmin CSV exports', () => {
    expect(
      extractGarminStartCoords({
        startingLatitudeInDegree: 48.7174,
        startingLongitudeInDegree: -122.3512,
      })
    ).toEqual({ lat: 48.7174, lng: -122.3512 });
  });

  it('falls back to legacy/misspelled names without throwing', () => {
    expect(
      extractGarminStartCoords({
        startLatitudeInDegrees: 1.5,
        startLongitudeInDegrees: 2.5,
      })
    ).toEqual({ lat: 1.5, lng: 2.5 });
    expect(
      extractGarminStartCoords({ beginLatitude: 3.5, beginLongitude: 4.5 })
    ).toEqual({ lat: 3.5, lng: 4.5 });
  });

  it('prefers the correct name when multiple are present', () => {
    expect(
      extractGarminStartCoords({
        startingLatitudeInDegrees: 10,
        startLatitudeInDegrees: 99,
        startingLongitudeInDegrees: 20,
        startLongitudeInDegrees: 99,
      })
    ).toEqual({ lat: 10, lng: 20 });
  });

  it('returns null for missing or non-finite coordinates', () => {
    expect(extractGarminStartCoords({})).toEqual({ lat: null, lng: null });
    expect(
      extractGarminStartCoords({
        startingLatitudeInDegrees: 'nope',
        startingLongitudeInDegrees: NaN,
      })
    ).toEqual({ lat: null, lng: null });
  });

  it('allows a valid latitude even when longitude is missing (and vice versa)', () => {
    expect(
      extractGarminStartCoords({ startingLatitudeInDegrees: 48.7 })
    ).toEqual({ lat: 48.7, lng: null });
  });

  it('treats 0 as a valid coordinate (equator/prime meridian), not missing', () => {
    expect(
      extractGarminStartCoords({
        startingLatitudeInDegrees: 0,
        startingLongitudeInDegrees: 0,
      })
    ).toEqual({ lat: 0, lng: 0 });
  });
});
