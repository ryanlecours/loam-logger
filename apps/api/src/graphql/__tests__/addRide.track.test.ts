// Wiring tests for addRide's in-app recording track.
//
// lib/recorded-track covers the normalizer and lib/ride-track covers the read
// path, but neither sees the seam between them: whether the resolver actually
// calls saveRideStream with the right source, whether it queues lift
// detection, and whether a bad or failing track really does leave the ride
// alone instead of taking it down. Those are the parts a refactor breaks
// silently, because every one of them is fire-and-forget and none of them
// changes the mutation's result.
//
// normalizeRecordedTrack is deliberately NOT mocked: it is pure, and letting
// it run means the "invalid" branch is reached the way production reaches it.

jest.mock('@paralleldrive/cuid2', () => ({ createId: jest.fn(() => 'mock-cuid') }));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    ride: { findUnique: jest.fn(), create: jest.fn() },
    rideStream: { findUnique: jest.fn() },
    bike: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../lib/rate-limit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkQueryRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../../services/prediction/cache', () => ({
  invalidateBikePrediction: jest.fn().mockResolvedValue(undefined),
  getCachedAdvisorSummary: jest.fn().mockResolvedValue(null),
  setCachedAdvisorSummary: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/advisor/summarize', () => ({
  generateSummary: jest.fn(),
  DEFAULT_ADVISOR_MODEL: 'claude-haiku-4-5-20251001',
}));

jest.mock('../../services/prediction', () => ({
  generateBikePredictions: jest.fn(),
  degradeSummaryForFreeTier:
    jest.requireActual('../../services/prediction/degrade').degradeSummaryForFreeTier,
}));

jest.mock('../../services/notification.service', () => ({
  clearServiceNotificationLogs: jest.fn().mockResolvedValue(undefined),
  fireServiceDueForBike: jest.fn().mockResolvedValue(undefined),
  isValidExpoPushToken: jest.fn(() => true),
}));

jest.mock('../../lib/queue/weather.queue', () => ({
  enqueueWeatherJob: jest.fn().mockResolvedValue({ enqueued: true }),
}));

jest.mock('../../lib/queue/lift.queue', () => ({
  enqueueLiftDetectionJob: jest.fn().mockResolvedValue({ status: 'queued', jobId: 'j' }),
  getLiftQueue: jest.fn(),
  closeLiftQueue: jest.fn(),
  buildLiftJobId: jest.fn((rideId: string) => `detectLifts_${rideId}`),
}));

jest.mock('../../lib/ride-stream-store', () => ({
  saveRideStream: jest.fn().mockResolvedValue(undefined),
  deleteRideStreamsForProvider: jest.fn(),
  persistGarminStream: jest.fn(),
}));

jest.mock('../../lib/posthog', () => ({
  captureServerEvent: jest.fn(),
  flushPostHog: jest.fn().mockResolvedValue(undefined),
  invalidateOptOutCache: jest.fn(),
}));

jest.mock('../../lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { resolvers } from '../resolvers';
import { prisma } from '../../lib/prisma';
import { saveRideStream } from '../../lib/ride-stream-store';
import { enqueueLiftDetectionJob } from '../../lib/queue/lift.queue';
import { logError, logger } from '../../lib/logger';

const mockPrisma = prisma as unknown as {
  ride: { findUnique: jest.Mock; create: jest.Mock };
  rideStream: { findUnique: jest.Mock };
  bike: { findMany: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
};
const mockSaveRideStream = saveRideStream as jest.Mock;
const mockEnqueueLift = enqueueLiftDetectionJob as jest.Mock;
const mockLogError = logError as jest.Mock;
const mockLogger = logger as unknown as { warn: jest.Mock };

const ctx = { user: { id: 'user-1' }, req: { ip: '127.0.0.1', headers: {} } };
const RIDE = { id: 'ride-1', userId: 'user-1' };

function track(points = 10) {
  return {
    time: Array.from({ length: points }, (_, i) => i * 2),
    latlng: Array.from({ length: points }, (_, i) => [48.7519 + i * 1e-4, -122.4787]),
    altitude: Array.from({ length: points }, (_, i) => 100 + i),
    moving: Array.from({ length: points }, () => true),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    startTime: '2026-08-06T23:44:00.000Z',
    durationSeconds: 2940,
    distanceMeters: 3058,
    elevationGainMeters: 324,
    rideType: 'TRAIL',
    // Keeps the bike/component-hours machinery out of the way: this file is
    // about the track, and an unowned ride skips bike lookup entirely.
    unownedBike: true,
    ...overrides,
  };
}

const addRide = (args: Record<string, unknown>) =>
  (resolvers.Mutation as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>).addRide(
    {},
    { input: args },
    ctx as never
  );

/**
 * The create path fires the track write with `void`, so it settles after the
 * mutation resolves. Flushing the microtask queue and one macrotask turn is
 * what lets the assertions see it.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.ride.findUnique.mockResolvedValue(null);
  mockPrisma.rideStream.findUnique.mockResolvedValue(null);
  mockPrisma.bike.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ ride: { create: jest.fn().mockResolvedValue(RIDE) } })
  );
  mockSaveRideStream.mockResolvedValue(undefined);
  mockEnqueueLift.mockResolvedValue({ status: 'queued', jobId: 'j' });
});

describe('addRide track persistence', () => {
  it('stores a valid track as a loam stream and queues lift detection', async () => {
    await addRide(input({ track: track(10) }));
    await settle();

    expect(mockSaveRideStream).toHaveBeenCalledTimes(1);
    const [rideId, source, pointCount, data] = mockSaveRideStream.mock.calls[0];
    expect(rideId).toBe('ride-1');
    expect(source).toBe('loam');
    expect(pointCount).toBe(10);
    expect(data.latlng).toHaveLength(10);
    // A shuttle lap logged in-app is as much not-pedalling as a synced one.
    expect(mockEnqueueLift).toHaveBeenCalledWith({ rideId: 'ride-1' });
  });

  it('does nothing at all for a ride with no track', async () => {
    await addRide(input());
    await settle();

    expect(mockSaveRideStream).not.toHaveBeenCalled();
    expect(mockEnqueueLift).not.toHaveBeenCalled();
  });

  it('drops a malformed track, keeps the ride, and says so in the log', async () => {
    const ragged = track(10);
    ragged.altitude.pop();

    const ride = await addRide(input({ track: ragged }));
    await settle();

    // The ride is the thing the rider cares about and the thing their
    // component hours depend on. Rejecting would be worse than it sounds:
    // the mobile outbox treats a deterministic failure as terminal.
    expect(ride).toEqual(RIDE);
    expect(mockSaveRideStream).not.toHaveBeenCalled();
    expect(mockEnqueueLift).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'recorded_track_rejected', rideId: 'ride-1' }),
      expect.any(String)
    );
  });

  it('survives a stream write that throws, without failing the mutation', async () => {
    mockSaveRideStream.mockRejectedValue(new Error('db down'));

    await expect(addRide(input({ track: track(10) }))).resolves.toEqual(RIDE);
    await settle();

    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('ride-1'),
      expect.any(Error)
    );
    expect(mockEnqueueLift).not.toHaveBeenCalled();
  });

  it('survives a lift enqueue that throws', async () => {
    mockEnqueueLift.mockRejectedValue(new Error('redis down'));

    await expect(addRide(input({ track: track(10) }))).resolves.toEqual(RIDE);
    await settle();

    expect(mockSaveRideStream).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalled();
  });
});

// The window this covers: the ride commits, then the process dies before the
// fire-and-forget track write lands. SIGTERM during a rolling deploy does not
// drain detached work, so without recovery here the outbox's retry would hit
// the idempotency shortcut, return the existing ride, and the route would be
// gone permanently with nothing logged.
describe('addRide track persistence on a clientMutationId replay', () => {
  const EXISTING = { id: 'ride-1', userId: 'user-1' };

  beforeEach(() => {
    mockPrisma.ride.findUnique.mockResolvedValue(EXISTING);
  });

  it('recovers a track the original submit never finished storing', async () => {
    mockPrisma.rideStream.findUnique.mockResolvedValue(null);

    const ride = await addRide(input({ track: track(10), clientMutationId: 'abc' }));

    expect(ride).toEqual(EXISTING);
    // Awaited on this path, so no settle() is needed: the response is held
    // until the track is durable, which is what makes the retry recoverable
    // if this attempt is killed too.
    expect(mockSaveRideStream).toHaveBeenCalledWith('ride-1', 'loam', 10, expect.any(Object));
    expect(mockEnqueueLift).toHaveBeenCalledWith({ rideId: 'ride-1' });
  });

  it('does not rewrite a track the original already stored', async () => {
    mockPrisma.rideStream.findUnique.mockResolvedValue({ rideId: 'ride-1' });

    const ride = await addRide(input({ track: track(10), clientMutationId: 'abc' }));

    expect(ride).toEqual(EXISTING);
    expect(mockSaveRideStream).not.toHaveBeenCalled();
    expect(mockEnqueueLift).not.toHaveBeenCalled();
  });

  it('does not look for a stream when the replay carries no track', async () => {
    await addRide(input({ clientMutationId: 'abc' }));

    expect(mockPrisma.rideStream.findUnique).not.toHaveBeenCalled();
    expect(mockSaveRideStream).not.toHaveBeenCalled();
  });

  it('still returns the ride when the recovery write fails', async () => {
    mockPrisma.rideStream.findUnique.mockResolvedValue(null);
    mockSaveRideStream.mockRejectedValue(new Error('db down'));

    await expect(
      addRide(input({ track: track(10), clientMutationId: 'abc' }))
    ).resolves.toEqual(EXISTING);
    expect(mockLogError).toHaveBeenCalled();
  });
});
