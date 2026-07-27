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
