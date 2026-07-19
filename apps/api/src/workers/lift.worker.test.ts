// Stop side-effectful imports (Sentry init, BullMQ Redis connection) from
// firing just because the worker module is loaded.
jest.mock('../instrument', () => ({}));
jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../lib/queue/connection', () => ({ getQueueConnection: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: { findUnique: jest.fn() },
    rideStream: { upsert: jest.fn() },
  },
}));

jest.mock('../lib/strava-token', () => ({
  getValidStravaToken: jest.fn(),
}));

jest.mock('../lib/strava-streams', () => ({
  fetchStravaStreams: jest.fn(),
}));

import { processLiftJob } from './lift.worker';
import { prisma } from '../lib/prisma';
import { getValidStravaToken } from '../lib/strava-token';
import { fetchStravaStreams } from '../lib/strava-streams';

const mockFindUnique = prisma.ride.findUnique as jest.Mock;
const mockUpsert = prisma.rideStream.upsert as jest.Mock;
const mockGetToken = getValidStravaToken as jest.Mock;
const mockFetchStreams = fetchStravaStreams as jest.Mock;

const makeJob = (rideId = 'ride-1') => ({ data: { rideId }, id: 'job-1' } as never);

const baseRide = {
  id: 'ride-1',
  userId: 'user-1',
  stravaActivityId: '9876',
  startLat: 45.1,
  startLng: -122.3,
  stream: null,
};

describe('processLiftJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips when the ride does not exist', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips non-Strava rides', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRide, stravaActivityId: null });

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips rides without coordinates', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRide, startLat: null, startLng: null });

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips when a stream is already persisted', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRide, stream: { id: 'stream-1' } });

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockFetchStreams).not.toHaveBeenCalled();
  });

  it('skips (without throwing) when no valid token — user disconnected', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce(null);

    await processLiftJob(makeJob());

    expect(mockFetchStreams).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips persisting when the activity has no usable streams', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce('token-1');
    mockFetchStreams.mockResolvedValueOnce({ status: 'no_streams' });

    await processLiftJob(makeJob());

    expect(mockFetchStreams).toHaveBeenCalledWith('token-1', '9876');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('persists the stream on success', async () => {
    const data = {
      time: [0, 1],
      latlng: [[45.1, -122.3], [45.101, -122.3]],
      altitude: [100, 101],
    };
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce('token-1');
    mockFetchStreams.mockResolvedValueOnce({ status: 'ok', pointCount: 2, data });

    await processLiftJob(makeJob());

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ rideId: 'ride-1' });
    expect(call.create).toEqual({
      rideId: 'ride-1',
      source: 'strava',
      pointCount: 2,
      data,
    });
    expect(call.update).toMatchObject({ source: 'strava', pointCount: 2, data });
  });

  it('propagates fetch errors so BullMQ can retry the job', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce('token-1');
    mockFetchStreams.mockRejectedValueOnce(new Error('Strava streams API error: 500'));

    await expect(processLiftJob(makeJob())).rejects.toThrow('Strava streams API error: 500');
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
