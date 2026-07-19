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

  it('returns FETCHABLE for a Strava ride with coords and no stream', async () => {
    mockFindUnique.mockResolvedValueOnce(base);

    await expect(getRideTrack('user-1', 'ride-1')).resolves.toEqual({
      status: 'FETCHABLE',
      points: null,
      sampledFrom: null,
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
