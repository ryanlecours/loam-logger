jest.mock('./prisma', () => ({
  prisma: {
    ride: { findUnique: jest.fn() },
  },
}));

import { downsampleTrack, getRideTrack, TRACK_TARGET_POINTS } from './ride-track';
import { prisma } from './prisma';

const mockFindUnique = prisma.ride.findUnique as jest.Mock;

const makeLatLng = (n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [45 + i * 0.0001, -122] as [number, number]);

describe('downsampleTrack', () => {
  it('returns short tracks untouched', () => {
    const track = makeLatLng(500);
    expect(downsampleTrack(track)).toBe(track);
  });

  it('samples long tracks to the target, keeping both endpoints', () => {
    const track = makeLatLng(10_000);
    const sampled = downsampleTrack(track);

    expect(sampled).toHaveLength(TRACK_TARGET_POINTS);
    expect(sampled[0]).toEqual(track[0]);
    expect(sampled[sampled.length - 1]).toEqual(track[track.length - 1]);
    // Monotone progression — no duplicate bunching at the ends.
    expect(sampled[1][0]).toBeGreaterThan(sampled[0][0]);
    expect(sampled[400][0]).toBeCloseTo(45 + 5000 * 0.0001, 2);
  });
});

describe('getRideTrack', () => {
  beforeEach(() => jest.clearAllMocks());

  const base = {
    userId: 'user-1',
    stravaActivityId: '9876',
    startLat: 45.0,
    startLng: -122.0,
    stream: null as unknown,
  };

  it('throws identically for missing rides and other users rides', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(getRideTrack('user-1', 'ride-x')).rejects.toThrow('Ride not found');

    mockFindUnique.mockResolvedValueOnce({ ...base, userId: 'someone-else' });
    await expect(getRideTrack('user-1', 'ride-x')).rejects.toThrow('Ride not found');
  });

  it('returns AVAILABLE with downsampled points when a stream exists', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...base,
      stream: { pointCount: 3, data: { latlng: makeLatLng(3), time: [0, 1, 2] } },
    });

    const track = await getRideTrack('user-1', 'ride-1');

    expect(track.status).toBe('AVAILABLE');
    expect(track.points).toHaveLength(3);
    expect(track.sampledFrom).toBe(3);
  });

  describe('attribution', () => {
    // The map is a visual built from device-recorded GPS, so a Garmin-sourced
    // track has to carry "Garmin [device model]". Attribution follows the
    // STORED STREAM's source, not the ride's activity ids — a ride matched
    // across providers has ids for both but only one persisted stream, and
    // crediting the wrong provider is a misrepresentation either way.
    it('attributes a Garmin-sourced track to the recording device', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...base,
        garminDeviceName: 'edge_840',
        stream: {
          pointCount: 3,
          source: 'garmin',
          data: { latlng: makeLatLng(3), time: [0, 1, 2] },
        },
      });

      const track = await getRideTrack('user-1', 'ride-1');

      expect(track.source).toBe('garmin');
      expect(track.garminDeviceName).toBe('edge_840');
    });

    it('withholds the device on a Strava-sourced track, even for a ride that also has Garmin data', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...base,
        garminDeviceName: 'edge_840',
        stream: {
          pointCount: 3,
          source: 'strava',
          data: { latlng: makeLatLng(3), time: [0, 1, 2] },
        },
      });

      const track = await getRideTrack('user-1', 'ride-1');

      expect(track.source).toBe('strava');
      expect(track.garminDeviceName).toBeNull();
    });

    // An in-app recording is the rider's own GPS, held under no provider
    // grant, so it carries no third-party attribution. This is also the test
    // that keeps the route map working for natively recorded rides at all:
    // the mobile detail screen renders RideTrackMap for every ride and shows
    // it purely on AVAILABLE, so a source gate creeping in here would
    // silently take the map away from in-app rides while provider rides kept
    // theirs.
    it('serves an in-app recording like any other track, with no attribution', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...base,
        garminDeviceName: 'edge_840',
        stream: {
          pointCount: 3,
          source: 'loam',
          data: { latlng: makeLatLng(3), time: [0, 1, 2] },
        },
      });

      const track = await getRideTrack('user-1', 'ride-1');

      expect(track.status).toBe('AVAILABLE');
      expect(track.points).toHaveLength(3);
      expect(track.source).toBe('loam');
      expect(track.garminDeviceName).toBeNull();
    });

    it('reports no device when Garmin did not name one', async () => {
      mockFindUnique.mockResolvedValueOnce({
        ...base,
        garminDeviceName: null,
        stream: {
          pointCount: 3,
          source: 'garmin',
          data: { latlng: makeLatLng(3), time: [0, 1, 2] },
        },
      });

      const track = await getRideTrack('user-1', 'ride-1');

      expect(track.source).toBe('garmin');
      // Client falls back to plain "Garmin", which the guidelines permit.
      expect(track.garminDeviceName).toBeNull();
    });
  });

  it('returns FETCHABLE for a Strava ride with coords and no stream', async () => {
    mockFindUnique.mockResolvedValueOnce(base);

    await expect(getRideTrack('user-1', 'ride-1')).resolves.toEqual({
      status: 'FETCHABLE',
      points: null,
      sampledFrom: null,
      // No stream stored yet, so there is no source to attribute.
      source: null,
      garminDeviceName: null,
    });
  });

  it('returns UNAVAILABLE for non-Strava rides and rides without coords', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...base, stravaActivityId: null });
    await expect(getRideTrack('user-1', 'r')).resolves.toMatchObject({ status: 'UNAVAILABLE' });

    mockFindUnique.mockResolvedValueOnce({ ...base, startLat: null, startLng: null });
    await expect(getRideTrack('user-1', 'r')).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('degrades a latlng-less stream to UNAVAILABLE instead of throwing', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...base,
      stream: { pointCount: 10, data: { time: [0, 1] } },
    });

    await expect(getRideTrack('user-1', 'r')).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });
});
