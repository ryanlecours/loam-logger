// Mock dependencies before imports
jest.mock('../lib/queue/connection', () => ({
  getQueueConnection: jest.fn(() => ({
    connection: { host: 'localhost', port: 6379 },
  })),
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  UnrecoverableError: jest.requireActual('bullmq').UnrecoverableError,
}));

jest.mock('../lib/rate-limit', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));

jest.mock('../lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    backfillRequest: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    ride: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    importSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    // Needed by syncBikeComponentHours, which now runs inside the Garmin
    // callback's $transaction wrapper as part of the component-hour fix.
    component: { updateMany: jest.fn() },
    bike: { findMany: jest.fn() },
    userAccount: { findUnique: jest.fn() },
    // Pass the same mock as the transaction client so any tx.* calls hit the
    // same jest.fn instances the tests configure.
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return { prisma };
});

jest.mock('../lib/garmin-token', () => ({
  getValidGarminToken: jest.fn(),
}));

jest.mock('../lib/location', () => ({
  deriveLocationAsync: jest.fn().mockResolvedValue({ title: 'Test Location' }),
  shouldApplyAutoLocation: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logError: jest.fn(),
  // suunto-token.ts (loaded transitively via backfill.worker → suunto handlers)
  // calls createLogger at module load. Without this mock the test suite fails
  // before any test runs.
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('../config/env', () => ({
  config: {
    garminVerificationMode: false,
    garminApiBase: 'https://apis.garmin.com/wellness-api',
  },
}));

const mockFireRideNotifications = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/notification.service', () => ({
  fireRideNotifications: (...args: unknown[]) => mockFireRideNotifications(...args),
}));

// Mock global fetch
global.fetch = jest.fn();

import { createBackfillWorker, closeBackfillWorker } from './backfill.worker';
import { Worker } from 'bullmq';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import { prisma } from '../lib/prisma';
import { getValidGarminToken } from '../lib/garmin-token';
import { deriveLocationAsync, shouldApplyAutoLocation } from '../lib/location';

const MockedWorker = Worker as jest.MockedClass<typeof Worker>;
const mockAcquireLock = acquireLock as jest.MockedFunction<typeof acquireLock>;
const mockReleaseLock = releaseLock as jest.MockedFunction<typeof releaseLock>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetValidGarminToken = getValidGarminToken as jest.MockedFunction<typeof getValidGarminToken>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
const mockDeriveLocationAsync = deriveLocationAsync as jest.MockedFunction<typeof deriveLocationAsync>;
const mockShouldApplyAutoLocation = shouldApplyAutoLocation as jest.MockedFunction<typeof shouldApplyAutoLocation>;

describe('createBackfillWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeBackfillWorker();
  });

  it('should create a worker with correct queue name', () => {
    createBackfillWorker();

    expect(MockedWorker).toHaveBeenCalledWith(
      'backfill',
      expect.any(Function),
      expect.objectContaining({ concurrency: 5 })
    );
  });

  it('should return the same worker on subsequent calls', () => {
    const worker1 = createBackfillWorker();
    const worker2 = createBackfillWorker();

    expect(worker1).toBe(worker2);
    expect(MockedWorker).toHaveBeenCalledTimes(1);
  });

  it('should set up event handlers', () => {
    const mockOn = jest.fn();
    MockedWorker.mockImplementation(() => ({
      on: mockOn,
      close: jest.fn().mockResolvedValue(undefined),
    }) as never);

    createBackfillWorker();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('closeBackfillWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the worker if it exists', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    MockedWorker.mockImplementation(() => ({
      on: jest.fn(),
      close: mockClose,
    }) as never);

    createBackfillWorker();
    await closeBackfillWorker();

    expect(mockClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeBackfillWorker();
    await closeBackfillWorker();
    // No error thrown
  });
});

describe('processBackfillJob (via worker processor)', () => {
  let processBackfillJob: (job: {
    name: string;
    id?: string;
    data: {
      userId: string;
      provider: 'garmin';
      year?: string;
      callbackURL?: string;
    };
  }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    MockedWorker.mockImplementation((queueName, processor) => {
      processBackfillJob = processor as typeof processBackfillJob;
      return {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as never;
    });

    createBackfillWorker();
  });

  afterEach(async () => {
    await closeBackfillWorker();
  });

  describe('processCallback job', () => {
    beforeEach(() => {
      mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-token' });
      (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.ride.upsert as jest.Mock).mockResolvedValue({});
      // Multi-bike account by default (the case where Garmin's lack of gear
      // reporting leaves the ride unassigned). Tests that care override it.
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([
        { id: 'bike-1' },
        { id: 'bike-2' },
      ]);
      mockDeriveLocationAsync.mockResolvedValue({ title: 'Test Location' });
      mockShouldApplyAutoLocation.mockReturnValue(undefined);
    });

    it('should process callback URL and upsert cycling activities', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-123',
            activityType: 'cycling',
            activityName: 'Morning Ride',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
            distanceInMeters: 50000,
            totalElevationGainInMeters: 500,
            averageHeartRateInBeatsPerMinute: 145,
            // Garmin's real Activity Summary field names (with "ing").
            startingLatitudeInDegrees: 37.7749,
            startingLongitudeInDegrees: -122.4194,
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://apis.garmin.com/callback/xyz',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer valid-token',
            'Accept': 'application/json',
          },
        })
      );

      expect(mockPrisma.ride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { garminActivityId: 'activity-123' },
          create: expect.objectContaining({
            userId: 'user-123',
            garminActivityId: 'activity-123',
            rideType: 'cycling',
            // Coords must be parsed from Garmin's "starting…" fields and
            // persisted — without them the weather worker skips the ride.
            startLat: 37.7749,
            startLng: -122.4194,
          }),
        })
      );
    });

    /**
     * Garmin never reports which bike was ridden, so the sole-active-bike guess
     * is the only assignment a callback-delivered ride can get at ingest. This
     * path used to omit bikeId from `create` entirely, which left every
     * backfilled and every manually-updated Garmin activity unassigned even for
     * a rider who owns one bike, and an unassigned ride credits its hours to no
     * component at all.
     */
    it('assigns the sole active bike when the rider has exactly one', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([{ id: 'only-bike' }]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-solo',
            activityType: 'cycling',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
          },
        ]),
      } as never);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockPrisma.bike.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-123', status: 'ACTIVE' } })
      );
      expect(mockPrisma.ride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ bikeId: 'only-bike' }),
        })
      );
    });

    it('leaves the ride unassigned when the rider has more than one active bike', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-multi',
            activityType: 'cycling',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
          },
        ]),
      } as never);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockPrisma.ride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ bikeId: null }),
        })
      );
    });

    /**
     * A re-delivery must not revert a bike the rider assigned by hand. Garmin
     * re-sends an activity whenever it is edited in Garmin Connect, so this is
     * a routine event, not an edge case.
     */
    it('never carries bikeId in the update payload', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([{ id: 'only-bike' }]);
      (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue({
        location: null,
        bikeId: 'rider-picked-bike',
        durationSeconds: 3600,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-resend',
            activityType: 'cycling',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
          },
        ]),
      } as never);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      const upsertArg = (mockPrisma.ride.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertArg.update).not.toHaveProperty('bikeId');
    });

    /**
     * The same one-ride-two-deliveries case on the callback path, which is what
     * a backfill answers on: the Activity Details entry carries the "-detail"
     * id, the stats nested under `summary`, and the GPS samples. It has to land
     * on the row the Activity Summary already created.
     */
    it('updates the existing ride when the details arrive, rather than inserting a duplicate', async () => {
      (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue({
        location: null,
        bikeId: null,
        durationSeconds: 3600,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-123-detail',
            samples: [{ latitudeInDegree: 37.7749, longitudeInDegree: -122.4194 }],
            summary: {
              activityType: 'cycling',
              activityName: 'Morning Ride',
              startTimeInSeconds: 1706123456,
              durationInSeconds: 3600,
              distanceInMeters: 50000,
              totalElevationGainInMeters: 500,
              startingLatitudeInDegrees: 37.7749,
              startingLongitudeInDegrees: -122.4194,
            },
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockPrisma.ride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { garminActivityId: 'activity-123' } })
      );

      const keys = (mockPrisma.ride.upsert as jest.Mock).mock.calls.map(
        ([args]) => args.where.garminActivityId
      );
      expect(keys).not.toContain('activity-123-detail');
    });

    it('should fire fireRideNotifications after upserting a real-time callback ride (no active backfill session)', async () => {
      // No runningSession → isBackfill must be false so the user gets the
      // "Ride Synced" + bike-pick prompt push notifications. Regression
      // guard for the silent-Garmin-notification bug — processGarminCallback
      // previously upserted the ride but never called fireRideNotifications.
      (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null); // new ride
      (mockPrisma.ride.upsert as jest.Mock).mockResolvedValue({
        id: 'ride-from-callback',
        bikeId: null,
        durationSeconds: 3600,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-realtime',
            activityType: 'cycling',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
            distanceInMeters: 50000,
            totalElevationGainInMeters: 500,
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-realtime',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/realtime',
        },
      });

      expect(mockFireRideNotifications).toHaveBeenCalledTimes(1);
      expect(mockFireRideNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          rideId: 'ride-from-callback',
          isNewRide: true,
          isBackfill: false,
        })
      );
    });

    it('should pass isBackfill:true when a running ImportSession is present', async () => {
      // Running backfill session → fireRideNotifications still gets called
      // but with isBackfill: true so it suppresses the per-ride toast.
      // Important to assert that the call happens at all so backfilled rides
      // still trigger downstream side-effects (e.g., service-due check).
      (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue({ id: 'session-1' });
      (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.ride.upsert as jest.Mock).mockResolvedValue({
        id: 'ride-from-backfill',
        bikeId: null,
        durationSeconds: 3600,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-backfill',
            activityType: 'cycling',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
            distanceInMeters: 50000,
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-backfill',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/backfill',
        },
      });

      expect(mockFireRideNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ isBackfill: true })
      );
    });

    it('should skip non-cycling activities', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-run',
            activityType: 'running',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockPrisma.ride.upsert).not.toHaveBeenCalled();
    });

    it('should handle various cycling activity types', async () => {
      const cyclingTypes = [
        'mountain_biking',
        'road_biking',
        'gravel_cycling',
        'e_bike_fitness',
        'indoor_cycling',
      ];

      for (const activityType of cyclingTypes) {
        jest.clearAllMocks();
        mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-token' });
        (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue(null);
        (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);

        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve([
            {
              summaryId: `activity-${activityType}`,
              activityType,
              startTimeInSeconds: 1706123456,
              durationInSeconds: 3600,
            },
          ]),
        } as Response);

        await processBackfillJob({
          name: 'processCallback',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            callbackURL: 'https://apis.garmin.com/callback/xyz',
          },
        });

        expect(mockPrisma.ride.upsert).toHaveBeenCalled();
      }
    });

    it('should throw when the Garmin token refresh fails', async () => {
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'refresh_failed' as const });

      await expect(
        processBackfillJob({
          name: 'processCallback',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            callbackURL: 'https://apis.garmin.com/callback/xyz',
          },
        })
      ).rejects.toThrow('Garmin token refresh failed');
    });

    // Garmin answers a backfill request asynchronously, so the rider can
    // disconnect between asking and the callback arriving. Retrying cannot
    // produce a credential they revoked, so the job ends quietly.
    it('should drop the callback without throwing when the rider is disconnected', async () => {
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'disconnected' as const });

      await expect(
        processBackfillJob({
          name: 'processCallback',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            callbackURL: 'https://apis.garmin.com/callback/xyz',
          },
        })
      ).resolves.toBeUndefined();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw when callback fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      await expect(
        processBackfillJob({
          name: 'processCallback',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            callbackURL: 'https://apis.garmin.com/callback/xyz',
          },
        })
      ).rejects.toThrow('Garmin callback fetch failed: 401');
    });

    it('should throw when response is not an array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'not an array' }),
      } as Response);

      await expect(
        processBackfillJob({
          name: 'processCallback',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            callbackURL: 'https://apis.garmin.com/callback/xyz',
          },
        })
      ).rejects.toThrow('Unexpected response format from callback URL');
    });

    it('should update import session when processing activities', async () => {
      (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue({ id: 'session-123' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-123',
            activityType: 'cycling',
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockPrisma.importSession.update).toHaveBeenCalledWith({
        where: { id: 'session-123' },
        data: { lastActivityReceivedAt: expect.any(Date) },
      });
    });

    it('should not update import session when no activities processed', async () => {
      (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue({ id: 'session-123' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            summaryId: 'activity-run',
            activityType: 'running', // Non-cycling, will be skipped
            startTimeInSeconds: 1706123456,
            durationInSeconds: 3600,
          },
        ]),
      } as Response);

      await processBackfillJob({
        name: 'processCallback',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        },
      });

      expect(mockPrisma.importSession.update).not.toHaveBeenCalled();
    });
  });

  describe('repairGarminCoords job', () => {
    const aggregate = () => mockPrisma.ride.aggregate as jest.Mock;

    it('triggers a throttled Garmin backfill over the null-coord ride span', async () => {
      aggregate().mockResolvedValue({
        _count: { _all: 5 },
        _min: { startTime: new Date('2026-05-01T00:00:00Z') },
        _max: { startTime: new Date('2026-05-20T00:00:00Z') },
      });
      mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-token' });
      (global.fetch as jest.Mock).mockResolvedValue({ status: 202, ok: true });

      await processBackfillJob({
        name: 'repairGarminCoords',
        id: 'job-repair',
        data: { userId: 'user-123', provider: 'garmin' },
      });

      // Hit Garmin's backfill endpoint for the affected span.
      expect(global.fetch).toHaveBeenCalled();
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('/rest/backfill/activities');
    });

    it('does nothing when the user has no null-coord Garmin rides', async () => {
      aggregate().mockResolvedValue({
        _count: { _all: 0 },
        _min: { startTime: null },
        _max: { startTime: null },
      });

      await processBackfillJob({
        name: 'repairGarminCoords',
        id: 'job-repair',
        data: { userId: 'user-123', provider: 'garmin' },
      });

      expect(mockGetValidGarminToken).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it.each([['refresh_failed'], ['disconnected']] as const)(
      'skips (no throw) when the token is unavailable: %s',
      async (reason) => {
        aggregate().mockResolvedValue({
          _count: { _all: 3 },
          _min: { startTime: new Date('2026-05-01T00:00:00Z') },
          _max: { startTime: new Date('2026-05-10T00:00:00Z') },
        });
        mockGetValidGarminToken.mockResolvedValue({ ok: false, reason });

        await expect(
          processBackfillJob({
            name: 'repairGarminCoords',
            id: 'job-repair',
            data: { userId: 'user-123', provider: 'garmin' },
          })
        ).resolves.toBeUndefined();

        expect(global.fetch).not.toHaveBeenCalled();
      }
    );

    // The one case this job does not shrug off. Skipping quietly is right when
    // the repair can simply run again later; it is wrong when the reason it
    // cannot run is a key incident, because a maintenance job that no-ops
    // through an outage is one more place the outage looks like normal
    // operation.
    it('escalates rather than skipping when credentials will not decrypt', async () => {
      aggregate().mockResolvedValue({
        _count: { _all: 3 },
        _min: { startTime: new Date('2026-05-01T00:00:00Z') },
        _max: { startTime: new Date('2026-05-10T00:00:00Z') },
      });
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'undecryptable' as const });

      await expect(
        processBackfillJob({
          name: 'repairGarminCoords',
          id: 'job-repair',
          data: { userId: 'user-123', provider: 'garmin' },
        })
      ).rejects.toMatchObject({ name: 'UnrecoverableError' });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('backfillYear job', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:backfill:garmin:user-123',
        lockValue: 'value-123',
        redisAvailable: true,
      });
      mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-token' });
      (mockPrisma.backfillRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (mockPrisma.backfillRequest.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it('should throw when year is missing', async () => {
      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
          },
        })
      ).rejects.toThrow('backfillYear job requires year field');
    });

    it('should acquire and release lock', async () => {
      mockFetch.mockResolvedValue({
        status: 202,
        ok: true,
      } as Response);

      await processBackfillJob({
        name: 'backfillYear',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          year: '2024',
        },
      });

      expect(mockAcquireLock).toHaveBeenCalledWith('backfill', 'garmin', 'user-123');
      expect(mockReleaseLock).toHaveBeenCalledWith('lock:backfill:garmin:user-123', 'value-123');
    });

    it('should throw when lock is not available', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: false,
        redisAvailable: true,
      });

      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            year: '2024',
          },
        })
      ).rejects.toThrow('Lock not available, will retry');
    });

    it('should throw when the Garmin token refresh fails', async () => {
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'refresh_failed' as const });

      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            year: '2024',
          },
        })
      ).rejects.toThrow('Garmin token refresh failed');
    });

    // Rider-initiated, so it still throws rather than returning: the
    // BackfillRequest is already marked in_progress and the catch is what marks
    // it failed. It throws unrecoverably, though, because no number of retries
    // reconnects an account.
    it('should fail a disconnected rider without retrying', async () => {
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'disconnected' as const });

      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: { userId: 'user-123', provider: 'garmin', year: '2024' },
        })
      ).rejects.toMatchObject({ name: 'UnrecoverableError' });

      expect(mockPrisma.backfillRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
      );
    });

    it('should update status to in_progress at start', async () => {
      mockFetch.mockResolvedValue({
        status: 202,
        ok: true,
      } as Response);

      await processBackfillJob({
        name: 'backfillYear',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          year: '2024',
        },
      });

      expect(mockPrisma.backfillRequest.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          provider: 'garmin',
          year: '2024',
          status: { not: 'completed' },
        },
        data: { status: 'in_progress', updatedAt: expect.any(Date) },
      });
    });

    it('should mark as failed on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            year: '2024',
          },
        })
      ).rejects.toThrow();

      expect(mockPrisma.backfillRequest.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', provider: 'garmin', year: '2024' },
        data: { status: 'failed', updatedAt: expect.any(Date) },
      });
    });

    it('should mark as completed when all chunks return 409', async () => {
      // Mock to return 409 for all chunks (already completed)
      mockFetch.mockResolvedValue({
        status: 409,
        ok: false,
      } as Response);

      await processBackfillJob({
        name: 'backfillYear',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          year: '2024',
        },
      });

      // Should mark as completed
      expect(mockPrisma.backfillRequest.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', provider: 'garmin', year: '2024' },
        data: { status: 'completed', updatedAt: expect.any(Date) },
      });
    });

    it('should throw for unsupported provider', async () => {
      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'unsupported' as 'garmin',
            year: '2024',
          },
        })
      ).rejects.toThrow('Unsupported provider for backfill: unsupported');
    });

    it('should throw for invalid year', async () => {
      await expect(
        processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: {
            userId: 'user-123',
            provider: 'garmin',
            year: '1999', // Before 2000
          },
        })
      ).rejects.toThrow('Invalid year: 1999');
    });

    it('should handle 202 accepted responses', async () => {
      mockFetch.mockResolvedValue({
        status: 202,
        ok: true,
      } as Response);

      await processBackfillJob({
        name: 'backfillYear',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          year: '2024',
        },
      });

      // Should have called fetch for backfill endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/backfill/activities'),
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer valid-token',
            'Accept': 'application/json',
          },
        })
      );
    });

    it('should update backfilledUpTo for ytd', async () => {
      mockFetch.mockResolvedValue({
        status: 202,
        ok: true,
      } as Response);

      await processBackfillJob({
        name: 'backfillYear',
        id: 'job-123',
        data: {
          userId: 'user-123',
          provider: 'garmin',
          year: 'ytd',
        },
      });

      expect(mockPrisma.backfillRequest.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', provider: 'garmin', year: 'ytd' },
        data: { backfilledUpTo: expect.any(Date), updatedAt: expect.any(Date) },
      });
    });

    describe('activity details (ride maps)', () => {
      const requestedUrls = () => mockFetch.mock.calls.map(([url]) => String(url));
      const queryOf = (url: string) => url.slice(url.indexOf('?'));

      it('requests activityDetails over the same range as the summaries', async () => {
        mockFetch.mockResolvedValue({ status: 202, ok: true } as Response);

        await processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: { userId: 'user-123', provider: 'garmin', year: '2024' },
        });

        const urls = requestedUrls();
        const summaries = urls.find((u) => u.includes('/rest/backfill/activities'));
        const details = urls.find((u) => u.includes('/rest/backfill/activityDetails'));

        // Summaries carry no per-point GPS, so without this second request the
        // imported rides can never draw a map.
        expect(details).toBeDefined();
        expect(queryOf(details!)).toBe(queryOf(summaries!));
      });

      it('requests activityDetails even when Garmin already fulfilled the summaries', async () => {
        // The state a rider is in after a sync that came back mapless: Garmin
        // 409s the summary range it already sent, but the details are new.
        mockFetch.mockImplementation((url) =>
          Promise.resolve(
            String(url).includes('/rest/backfill/activityDetails')
              ? ({ status: 202, ok: true } as Response)
              : ({ status: 409, ok: false } as Response)
          )
        );

        await processBackfillJob({
          name: 'backfillYear',
          id: 'job-123',
          data: { userId: 'user-123', provider: 'garmin', year: '2024' },
        });

        expect(requestedUrls().some((u) => u.includes('/rest/backfill/activityDetails'))).toBe(true);
      });

      it('imports the rides even when the details request is rejected', async () => {
        // No activityDetails scope on the app: tracks are missing, which is the
        // status quo, but the ride history must still import.
        mockFetch.mockImplementation((url) =>
          Promise.resolve(
            String(url).includes('/rest/backfill/activityDetails')
              ? ({ status: 403, ok: false, text: () => Promise.resolve('Forbidden') } as Response)
              : ({ status: 202, ok: true } as Response)
          )
        );

        await expect(
          processBackfillJob({
            name: 'backfillYear',
            id: 'job-123',
            data: { userId: 'user-123', provider: 'garmin', year: '2024' },
          })
        ).resolves.toBeUndefined();

        expect(mockPrisma.backfillRequest.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
        );
      });
    });
  });
});

describe('Activity metric conversions', () => {
  let processBackfillJob: (job: {
    name: string;
    id?: string;
    data: {
      userId: string;
      provider: 'garmin';
      year?: string;
      callbackURL?: string;
    };
  }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    MockedWorker.mockImplementation((queueName, processor) => {
      processBackfillJob = processor as typeof processBackfillJob;
      return {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as never;
    });

    createBackfillWorker();

    mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-token' });
    (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([
      { id: 'bike-1' },
      { id: 'bike-2' },
    ]);
    mockDeriveLocationAsync.mockResolvedValue({ title: 'Test Location' });
    mockShouldApplyAutoLocation.mockReturnValue(undefined);
  });

  afterEach(async () => {
    await closeBackfillWorker();
  });

  it('should store raw distance in meters', async () => {
    let capturedArgs: unknown;
    (mockPrisma.ride.upsert as jest.Mock).mockImplementation((args) => {
      capturedArgs = args;
      return {};
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          summaryId: 'activity-123',
          activityType: 'cycling',
          startTimeInSeconds: 1706123456,
          durationInSeconds: 3600,
          distanceInMeters: 10000, // 10km
        },
      ]),
    } as Response);

    await processBackfillJob({
      name: 'processCallback',
      id: 'job-123',
      data: {
        userId: 'user-123',
        provider: 'garmin',
        callbackURL: 'https://apis.garmin.com/callback/xyz',
      },
    });

    const args = capturedArgs as { create: { distanceMeters: number } };
    expect(args.create.distanceMeters).toBe(10000);
  });

  it('should store raw elevation in meters', async () => {
    let capturedArgs: unknown;
    (mockPrisma.ride.upsert as jest.Mock).mockImplementation((args) => {
      capturedArgs = args;
      return {};
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          summaryId: 'activity-123',
          activityType: 'cycling',
          startTimeInSeconds: 1706123456,
          durationInSeconds: 3600,
          totalElevationGainInMeters: 100, // 100m
        },
      ]),
    } as Response);

    await processBackfillJob({
      name: 'processCallback',
      id: 'job-123',
      data: {
        userId: 'user-123',
        provider: 'garmin',
        callbackURL: 'https://apis.garmin.com/callback/xyz',
      },
    });

    const args = capturedArgs as { create: { elevationGainMeters: number } };
    expect(args.create.elevationGainMeters).toBe(100);
  });

  it('should use elevationGainInMeters as fallback', async () => {
    let capturedArgs: unknown;
    (mockPrisma.ride.upsert as jest.Mock).mockImplementation((args) => {
      capturedArgs = args;
      return {};
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          summaryId: 'activity-123',
          activityType: 'cycling',
          startTimeInSeconds: 1706123456,
          durationInSeconds: 3600,
          elevationGainInMeters: 50, // Fallback field
        },
      ]),
    } as Response);

    await processBackfillJob({
      name: 'processCallback',
      id: 'job-123',
      data: {
        userId: 'user-123',
        provider: 'garmin',
        callbackURL: 'https://apis.garmin.com/callback/xyz',
      },
    });

    const args = capturedArgs as { create: { elevationGainMeters: number } };
    expect(args.create.elevationGainMeters).toBe(50);
  });

  it('should handle missing distance and elevation', async () => {
    let capturedArgs: unknown;
    (mockPrisma.ride.upsert as jest.Mock).mockImplementation((args) => {
      capturedArgs = args;
      return {};
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          summaryId: 'activity-123',
          activityType: 'cycling',
          startTimeInSeconds: 1706123456,
          durationInSeconds: 3600,
          // No distance or elevation fields
        },
      ]),
    } as Response);

    await processBackfillJob({
      name: 'processCallback',
      id: 'job-123',
      data: {
        userId: 'user-123',
        provider: 'garmin',
        callbackURL: 'https://apis.garmin.com/callback/xyz',
      },
    });

    const args = capturedArgs as { create: { distanceMeters: number; elevationGainMeters: number } };
    expect(args.create.distanceMeters).toBe(0);
    expect(args.create.elevationGainMeters).toBe(0);
  });
});
