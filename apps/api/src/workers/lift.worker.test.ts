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
    ride: { findUnique: jest.fn(), updateMany: jest.fn() },
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
  computeAdjustedMetrics: jest.fn(),
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
  computeAdjustedMetrics,
  getLiftLines,
} from '../lib/lift-detection';

const mockFindUnique = prisma.ride.findUnique as jest.Mock;
const mockStreamUpsert = prisma.rideStream.upsert as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;
const mockGetToken = getValidStravaToken as jest.Mock;
const mockFetchStreams = fetchStravaStreams as jest.Mock;
const mockPointsFromStream = pointsFromStream as jest.Mock;
const mockDetect = detectLiftSegments as jest.Mock;
const mockAdjusted = computeAdjustedMetrics as jest.Mock;
const mockGetLiftLines = getLiftLines as jest.Mock;

/** What the stream says the ride descended; see "fills descent" below. */
const STREAM_DESCENT = 842.5;

const makeJob = (rideId = 'ride-1', data: { requireGeometry?: boolean } = {}) =>
  ({ data: { rideId, ...data }, id: 'job-1' }) as never;

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
  // No provider reported a descent, so the worker derives one from the stream.
  elevationLossMeters: null,
  stream: null,
  segments: [],
};

describe('processLiftJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn(mockTx));
    mockGetLiftLines.mockResolvedValue({ geometryAvailable: true, liftLines: [] });
    mockPointsFromStream.mockReturnValue(POINTS);
    mockDetect.mockReturnValue([]);
    mockAdjusted.mockReturnValue({ elevationLossMeters: STREAM_DESCENT });
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
      elevationLossMeters: 500,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });

    await processLiftJob(makeJob());

    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('fills descent for a current-version ride from its stored stream and segments, without re-detecting', async () => {
    // Analyzed before descent existed: the stream and the detector's
    // segments are on hand, so the descent is a sum, not a new analysis.
    // Re-detecting would call Overpass and, under rate limiting, replace
    // geometry-matched segments with kinematic-only ones.
    const existingSegments = [{ startIndex: 10, endIndex: 90 }];
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 1,
      elevationLossMeters: null,
      stream: { id: 'stream-1', data: STREAM_DATA },
      segments: existingSegments,
    });

    await processLiftJob(makeJob());

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockGetLiftLines).not.toHaveBeenCalled();
    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAdjusted).toHaveBeenCalledWith(POINTS, existingSegments);
    // Compare-and-set on the null, so a provider descent written meanwhile wins.
    expect(prisma.ride.updateMany).toHaveBeenCalledWith({
      where: { id: 'ride-1', elevationLossMeters: null },
      data: { elevationLossMeters: STREAM_DESCENT },
    });
  });

  it('takes the full pipeline, not the descent-only path, for a current-version ride that lost its stream but has a provider descent', async () => {
    // A Strava disconnect deletes streams while rides survive. The skip
    // needs a stream, so this ride gets re-fetched and re-analyzed, and its
    // provider descent must come through untouched.
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 1,
      elevationLossMeters: 500,
      stream: null,
    });
    mockGetToken.mockResolvedValueOnce('token');
    mockFetchStreams.mockResolvedValueOnce({ status: 'ok', pointCount: 2, data: STREAM_DATA });

    await processLiftJob(makeJob());

    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
    expect(mockDetect).toHaveBeenCalled();
    const data = mockTx.ride.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('elevationLossMeters');
  });

  it('re-analyzes instead of taking the descent-only path when the stream had to be refetched', async () => {
    // Stored segments index into the stream that was deleted; a fresh fetch
    // may not line up, so the ride earns a proper re-analysis.
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 1,
      elevationLossMeters: null,
      stream: null,
      segments: [{ startIndex: 10, endIndex: 90 }],
    });
    mockGetToken.mockResolvedValueOnce('token');
    mockFetchStreams.mockResolvedValueOnce({ status: 'ok', pointCount: 2, data: STREAM_DATA });

    await processLiftJob(makeJob());

    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
    expect(mockDetect).toHaveBeenCalled();
    expect(mockTx.ride.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ elevationLossMeters: STREAM_DESCENT }) })
    );
  });

  it('takes the full pipeline for a stale-version ride with no descent', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 0,
      elevationLossMeters: null,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });

    await processLiftJob(makeJob());

    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
    expect(mockDetect).toHaveBeenCalled();
    expect(mockTx.ride.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ elevationLossMeters: STREAM_DESCENT }) })
    );
  });

  it('accepts losing the compare-and-set to a provider write without further writes', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 1,
      elevationLossMeters: null,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    (prisma.ride.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await expect(processLiftJob(makeJob())).resolves.toBeUndefined();

    expect(prisma.ride.updateMany).toHaveBeenCalledTimes(1);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('writes nothing on the descent-only path when the track is too short', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      liftDetectorVersion: 1,
      elevationLossMeters: null,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockPointsFromStream.mockReturnValueOnce([POINTS[0]]);

    await processLiftJob(makeJob());

    expect(mockAdjusted).not.toHaveBeenCalled();
    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('leaves descent null for a track too short to sum, rather than writing 0', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockPointsFromStream.mockReturnValueOnce([POINTS[0]]);

    await processLiftJob(makeJob());

    expect(mockAdjusted).not.toHaveBeenCalled();
    const data = mockTx.ride.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('elevationLossMeters');
  });

  it('does not store a non-finite stream sum', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockAdjusted.mockReturnValueOnce({ elevationLossMeters: NaN });

    await processLiftJob(makeJob());

    const data = mockTx.ride.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('elevationLossMeters');
  });

  it('never overwrites a provider-reported descent with the stream-derived one', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      elevationLossMeters: 500,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });

    await processLiftJob(makeJob());

    expect(mockAdjusted).not.toHaveBeenCalled();
    const data = mockTx.ride.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('elevationLossMeters');
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
        elevationLossMeters: STREAM_DESCENT,
      },
    });
    // Descent is summed over the whole track with the lift segments known,
    // so the pure function gets both.
    expect(mockAdjusted).toHaveBeenCalledWith(POINTS, [SEGMENT]);
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
        elevationLossMeters: STREAM_DESCENT,
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

  it('defers, writing nothing, when geometry is required and the Overpass fetch failed', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockGetLiftLines.mockResolvedValueOnce({
      geometryAvailable: false,
      liftLines: [],
      reason: 'fetch_failed',
    });

    // The throw is what hands the job back to BullMQ for a later attempt;
    // the segments on record stay as they are until an attempt gets geometry.
    await expect(processLiftJob(makeJob('ride-1', { requireGeometry: true }))).rejects.toThrow(
      'Lift geometry unavailable'
    );
    expect(mockDetect).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('runs kinematic-only when geometry is required but the ride is too large for the geometry layer', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...baseRide,
      stream: { id: 'stream-1', data: STREAM_DATA },
    });
    mockGetLiftLines.mockResolvedValueOnce({
      geometryAvailable: false,
      liftLines: [],
      reason: 'too_large',
    });

    // Retrying would never help this ride, so its kinematic-only answer is
    // final and gets stored.
    await processLiftJob(makeJob('ride-1', { requireGeometry: true }));

    expect(mockDetect).toHaveBeenCalledWith(POINTS, [], KINEMATIC_ONLY_OPTIONS);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
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
