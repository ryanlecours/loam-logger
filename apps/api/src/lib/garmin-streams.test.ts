jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { normalizeGarminSamples, type GarminActivitySample } from './garmin-streams';

const START = 1_700_000_000;

const sample = (overrides: Partial<GarminActivitySample> = {}): GarminActivitySample => ({
  startTimeInSeconds: START,
  latitudeInDegree: 45.5,
  longitudeInDegree: -122.6,
  elevationInMeters: 100,
  heartRate: 145,
  speedMetersPerSecond: 5,
  bikeCadenceInRPM: 85,
  powerInWatts: 220,
  ...overrides,
});

describe('normalizeGarminSamples', () => {
  it('rebases absolute Garmin timestamps onto seconds-since-start', () => {
    const result = normalizeGarminSamples(
      [
        sample({ startTimeInSeconds: START }),
        sample({ startTimeInSeconds: START + 10 }),
        sample({ startTimeInSeconds: START + 25 }),
      ],
      START
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.time).toEqual([0, 10, 25]);
    expect(result.pointCount).toBe(3);
  });

  it('maps every Garmin sensor field onto the shared stream shape', () => {
    const result = normalizeGarminSamples([sample()], START);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.latlng).toEqual([[45.5, -122.6]]);
    expect(result.data.altitude).toEqual([100]);
    expect(result.data.heartrate).toEqual([145]);
    expect(result.data.velocity).toEqual([5]);
    expect(result.data.cadence).toEqual([85]);
    expect(result.data.power).toEqual([220]);
  });

  describe('precision', () => {
    // Garmin sends raw doubles; Strava's API already rounds to these places.
    // Persisting the full double costs real storage for no observable gain.
    it('rounds coordinates, altitude and speed to the precision Strava uses', () => {
      const result = normalizeGarminSamples(
        [
          sample({
            latitudeInDegree: 43.80667565390468,
            longitudeInDegree: -116.2612781301141,
            elevationInMeters: 174.6000061035156,
            speedMetersPerSecond: 1.064000010490417,
          }),
        ],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.latlng).toEqual([[43.806676, -116.261278]]);
      expect(result.data.altitude).toEqual([174.6]);
      expect(result.data.velocity).toEqual([1.064]);
    });

    it('leaves integer sensor readings untouched', () => {
      const result = normalizeGarminSamples(
        [sample({ heartRate: 145, bikeCadenceInRPM: 85, powerInWatts: 220 })],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.heartrate).toEqual([145]);
      expect(result.data.cadence).toEqual([85]);
      expect(result.data.power).toEqual([220]);
    });

    it('applies the moving threshold to the raw speed, not the rounded one', () => {
      // 0.5004 rounds to 0.500, which is NOT above the 0.5 m/s threshold once
      // rounded, but the raw reading is. The threshold is deliberately applied
      // to the raw reading; this pins that so a refactor cannot flip it.
      const result = normalizeGarminSamples(
        [sample({ speedMetersPerSecond: 0.5004 })],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.velocity).toEqual([0.5]);
      expect(result.data.moving).toEqual([true]);
    });

    it('rounds small negative values to a plain zero', () => {
      // A reading like -0.04 m rounds to -0 in JavaScript. Persisted JSON
      // cannot tell -0 from 0, so the stored value must simply equal 0.
      const result = normalizeGarminSamples(
        [sample({ elevationInMeters: -0.04, speedMetersPerSecond: -0.0004 })],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.altitude).toEqual([0]);
      expect(result.data.velocity).toEqual([0]);
      expect(JSON.stringify(result.data.altitude)).toBe('[0]');
    });

    it('still records 0 for a sample whose speed is missing', () => {
      const result = normalizeGarminSamples(
        [sample({ speedMetersPerSecond: 3.25 }), sample({ startTimeInSeconds: START + 5, speedMetersPerSecond: undefined })],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.velocity).toEqual([3.25, 0]);
    });
  });

  describe('index alignment', () => {
    // RideSegment persists integer indexes into these arrays, so a ragged
    // result would silently mis-slice previously-detected lift segments.
    it('keeps every array the same length when samples are dropped', () => {
      const result = normalizeGarminSamples(
        [
          sample({ startTimeInSeconds: START }),
          sample({ startTimeInSeconds: START + 5, latitudeInDegree: undefined }),
          sample({ startTimeInSeconds: undefined }),
          sample({ startTimeInSeconds: START + 15 }),
        ],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;

      const { time, latlng, altitude, velocity, cadence, heartrate, power, moving } =
        result.data;
      const lengths = [latlng, altitude, velocity, cadence, heartrate, power, moving].map(
        (a) => a?.length
      );
      expect(time).toHaveLength(2);
      expect(new Set(lengths)).toEqual(new Set([2]));
    });

    it('sorts out-of-order samples while keeping arrays aligned', () => {
      const result = normalizeGarminSamples(
        [
          sample({ startTimeInSeconds: START + 20, heartRate: 3, elevationInMeters: 300 }),
          sample({ startTimeInSeconds: START, heartRate: 1, elevationInMeters: 100 }),
          sample({ startTimeInSeconds: START + 10, heartRate: 2, elevationInMeters: 200 }),
        ],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.time).toEqual([0, 10, 20]);
      // Alignment is what matters: the HR and elevation for t=0 must still be
      // the ones that arrived with that timestamp, not the array's first entry.
      expect(result.data.heartrate).toEqual([1, 2, 3]);
      expect(result.data.altitude).toEqual([100, 200, 300]);
    });
  });

  describe('sensor series that were never reported', () => {
    // A flat zero series would read as a real (and completely wrong) elevation
    // profile to the lift detector, which returns null only on a MISSING
    // altitude series.
    it('omits a series entirely rather than persisting zeros', () => {
      const result = normalizeGarminSamples(
        [
          sample({ elevationInMeters: undefined, powerInWatts: undefined }),
          sample({
            startTimeInSeconds: START + 10,
            elevationInMeters: undefined,
            powerInWatts: undefined,
          }),
        ],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.altitude).toBeUndefined();
      expect(result.data.power).toBeUndefined();
      expect(result.data.heartrate).toEqual([145, 145]);
    });

    it('keeps a partially-reported series', () => {
      const result = normalizeGarminSamples(
        [
          sample({ elevationInMeters: 100 }),
          sample({ startTimeInSeconds: START + 10, elevationInMeters: undefined }),
        ],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.altitude).toEqual([100, 0]);
    });
  });

  describe('moving flag', () => {
    it('derives moving from speed, since Garmin reports no such flag', () => {
      const result = normalizeGarminSamples(
        [
          sample({ speedMetersPerSecond: 5 }),
          sample({ startTimeInSeconds: START + 10, speedMetersPerSecond: 0 }),
          sample({ startTimeInSeconds: START + 20, speedMetersPerSecond: 0.1 }),
        ],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.moving).toEqual([true, false, false]);
    });

    it('omits moving when speed was never reported', () => {
      const result = normalizeGarminSamples(
        [sample({ speedMetersPerSecond: undefined })],
        START
      );

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.data.moving).toBeUndefined();
    });
  });

  describe('no usable stream', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty array', []],
    ])('returns no_streams for %s', (_label, input) => {
      expect(normalizeGarminSamples(input as GarminActivitySample[], START).status).toBe(
        'no_streams'
      );
    });

    it('returns no_streams for an indoor ride with no GPS fix', () => {
      const result = normalizeGarminSamples(
        [
          sample({ latitudeInDegree: undefined, longitudeInDegree: undefined }),
          sample({ startTimeInSeconds: START + 10, latitudeInDegree: undefined }),
        ],
        START
      );

      expect(result.status).toBe('no_streams');
    });

    it('treats Garmin\'s 0/0 "no fix" sentinel as no fix', () => {
      const result = normalizeGarminSamples(
        [sample({ latitudeInDegree: 0, longitudeInDegree: 0 })],
        START
      );

      expect(result.status).toBe('no_streams');
    });

    it('rejects out-of-range coordinates', () => {
      const result = normalizeGarminSamples(
        [sample({ latitudeInDegree: 200, longitudeInDegree: -122.6 })],
        START
      );

      expect(result.status).toBe('no_streams');
    });
  });

  it('drops samples stamped before the activity start rather than emitting negative offsets', () => {
    const result = normalizeGarminSamples(
      [
        sample({ startTimeInSeconds: START - 30 }),
        sample({ startTimeInSeconds: START + 10 }),
      ],
      START
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.time).toEqual([10]);
  });
});
