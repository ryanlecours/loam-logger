// Stop side-effectful imports (Sentry init, BullMQ Redis connection) from
// firing just because the worker module is loaded.
jest.mock('../instrument', () => ({}));
jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../lib/queue/connection', () => ({ getQueueConnection: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const mockTx = {
  rideSegment: { deleteMany: jest.fn(), createMany: jest.fn() },
  ride: { update: jest.fn() },
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: { findUnique: jest.fn() },
    rideStream: { upsert: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(mockTx)),
  },
}));

jest.mock('../lib/strava-token', () => ({
  getValidStravaToken: jest.fn(),
}));

jest.mock('../lib/strava-streams', () => ({
  fetchStravaStreams: jest.fn(),
}));

jest.mock('../lib/lift-detection', () => ({
  DETECTOR_VERSION: 1,
  DEFAULT_OPTIONS: { openThreshold: 0.62 },
  KINEMATIC_ONLY_OPTIONS: { openThreshold: 0.72 },
  pointsFromStream: jest.fn(),
  detectLiftSegments: jest.fn(),
  getLiftLines: jest.fn(),
}));

import { processLiftJob } from './lift.worker';
import { prisma } from '../lib/prisma';
import { getValidStravaToken } from '../lib/strava-token';
import { fetchStravaStreams } from '../lib/strava-streams';
import {
  DEFAULT_OPTIONS,
  KINEMATIC_ONLY_OPTIONS,
  pointsFromStream,
  detectLiftSegments,
  getLiftLines,
} from '../lib/lift-detection';

const mockFindUnique = prisma.ride.findUnique as jest.Mock;
const mockStreamUpsert = prisma.rideStream.upsert as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockGetToken = getValidStravaToken as jest.Mock;
const mockFetchStreams = fetchStravaStreams as jest.Mock;
const mockPointsFromStream = pointsFromStream as jest.Mock;
const mockDetect = detectLiftSegments as jest.Mock;
const mockGetLiftLines = getLiftLines as jest.Mock;

const makeJob = (rideId = 'ride-1') => ({ data: { rideId }, id: 'job-1' } as never);

const RIDE_START = new Date('2026-07-01T09:00:00Z');
const STREAM_DATA = { time: [0, 5], latlng: [[45, -122], [45.001, -122]], altitude: [1000, 1010] };
const POINTS = [
  { t: 0, lat: 45, lng: -122, ele: 1000 },
  { t: 5, lat: 45.001, lng: -122, ele: 1010 },
];
const SEGMENT = {
  startIndex: 10,
  endIndex: 90,
  startTimeOffsetSec: 50,
  endTimeOffsetSec: 450,
  durationSec: 400,
  distanceMeters: 1600,
  elevationGainMeters: 155.5,
  confidence: 0.97,
  kinematicScore: 0.95,
  geometryScore: 0.98,
  matchedLiftName: 'Summit Express',
  matchedLiftId: 'way-99',
};

const baseRide = {
  id: 'ride-1',
  userId: 'user-1',
  startTime: RIDE_START,
  stravaActivityId: '9876',
  startLat: 45.0,
  startLng: -122.0,
  liftDetectorVersion: null,
  stream: null,
};

describe('processLiftJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn(mockTx));
    mockGetLiftLines.mockResolvedValue({ geometryAvailable: true, liftLines: [] });
    mockPointsFromStream.mockReturnValue(POINTS);
    mockDetect.mockReturnValue([]);
  });

  it('skips when the ride does not exist', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('skips non-Strava rides and rides without coordinates', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...baseRide, stravaActivityId: null });
    await processLiftJob(makeJob());

    mockFindUnique.mockResolvedValueOnce({ ...baseRide, startLat: null, startLng: null });
    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('skips rides already analyzed at the current detector version', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 1,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });

    await processLiftJob(makeJob());

    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('re-detects from the persisted stream without calling Strava when the version is stale', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: null,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockFetchStreams).not.toHaveBeenCalled();
    expect(mockPointsFromStream).toHaveBeenCalledWith(STREAM_DATA);
    expect(mockDetect).toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('fetches and persists the stream first when none exists', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce('token-1');
    mockFetchStreams.mockResolvedValueOnce({ status: 'ok', pointCount: 2, data: STREAM_DATA });

    await processLiftJob(makeJob());

    expect(mockFetchStreams).toHaveBeenCalledWith('token-1', '9876');
    expect(mockStreamUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rideId: 'ride-1' },
        create: expect.objectContaining({ source: 'strava', pointCount: 2, data: STREAM_DATA }),
      })
    );
    expect(mockPointsFromStream).toHaveBeenCalledWith(STREAM_DATA);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('skips without throwing when no valid token — user disconnected', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce(null);

    await processLiftJob(makeJob());

    expect(mockFetchStreams).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('stops after no_streams without persisting anything', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce('token-1');
    mockFetchStreams.mockResolvedValueOnce({ status: 'no_streams' });

    await processLiftJob(makeJob());

    expect(mockStreamUpsert).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('leaves rides with no altitude series unanalyzed (detector version stays null)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockPointsFromStream.mockReturnValueOnce(null);

    await processLiftJob(makeJob());

    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('persists segments with times anchored to ride start, and delta sums on the ride', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockDetect.mockReturnValueOnce([SEGMENT]);

    await processLiftJob(makeJob());

    expect(mockTx.rideSegment.deleteMany).toHaveBeenCalledWith({ where: { rideId: 'ride-1' } });
    expect(mockTx.rideSegment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          rideId: 'ride-1',
          kind: 'LIFT',
          startIndex: 10,
          endIndex: 90,
          startTime: new Date(RIDE_START.getTime() + 50 * 1000),
          endTime: new Date(RIDE_START.getTime() + 450 * 1000),
          confidence: 0.97,
          geometryScore: 0.98,
          kinematicScore: 0.95,
          liftName: 'Summit Express',
          liftOsmId: 'way-99',
          durationSeconds: 400,
          elevationGainMeters: 155.5,
          distanceMeters: 1600,
          detectorVersion: 1,
        }),
      ],
    });
    expect(mockTx.ride.update).toHaveBeenCalledWith({
      where: { id: 'ride-1' },
      data: {
        liftDurationSeconds: 400,
        liftElevationGainMeters: 155.5,
        liftDistanceMeters: 1600,
        liftDetectorVersion: 1,
      },
    });
  });

  it('records "analyzed, no lift" as zero deltas at the current version', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockDetect.mockReturnValueOnce([]);

    await processLiftJob(makeJob());

    expect(mockTx.rideSegment.deleteMany).toHaveBeenCalled();
    expect(mockTx.rideSegment.createMany).not.toHaveBeenCalled();
    expect(mockTx.ride.update).toHaveBeenCalledWith({
      where: { id: 'ride-1' },
      data: {
        liftDurationSeconds: 0,
        liftElevationGainMeters: 0,
        liftDistanceMeters: 0,
        liftDetectorVersion: 1,
      },
    });
  });

  it('uses stricter options and nulls geometryScore when Overpass is unavailable', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockGetLiftLines.mockResolvedValueOnce({ geometryAvailable: false, liftLines: [] });
    mockDetect.mockReturnValueOnce([SEGMENT]);

    await processLiftJob(makeJob());

    expect(mockDetect).toHaveBeenCalledWith(POINTS, [], KINEMATIC_ONLY_OPTIONS);
    const created = mockTx.rideSegment.createMany.mock.calls[0][0].data[0];
    expect(created.geometryScore).toBeNull();
  });

  it('passes lift lines and default options when geometry is available', async () => {
    const lines = [{ id: 'way-99', kind: 'chair_lift', coordinates: [] }];
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockGetLiftLines.mockResolvedValueOnce({ geometryAvailable: true, liftLines: lines });

    await processLiftJob(makeJob());

    expect(mockDetect).toHaveBeenCalledWith(POINTS, lines, DEFAULT_OPTIONS);
  });

  it('propagates stream-fetch errors so BullMQ can retry the job', async () => {
    mockFindUnique.mockResolvedValueOnce(baseRide);
    mockGetToken.mockResolvedValueOnce('token-1');
    mockFetchStreams.mockRejectedValueOnce(new Error('Strava streams API error: 500'));

    await expect(processLiftJob(makeJob())).rejects.toThrow('Strava streams API error: 500');
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
