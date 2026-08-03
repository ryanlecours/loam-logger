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
  DelayedError: class DelayedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DelayedError';
    }
  },
}));

jest.mock('../lib/rate-limit', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  // Suunto outbound quota — always-allow default so existing tests pass.
  acquireSuuntoApiCall: jest.fn().mockResolvedValue({
    allowed: true,
    minuteCount: 1,
    weekCount: 1,
    redisAvailable: true,
  }),
  getSuuntoWeekCount: jest.fn().mockResolvedValue(0),
  SUUNTO_QUOTA: { perMinute: 10, perWeek: 200, weeklyStartRejectAt: 150 },
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    stravaGearMapping: { findUnique: jest.fn() },
    bike: { findMany: jest.fn() },
    ride: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    component: { updateMany: jest.fn() },
    // The Garmin upsert path looks for a running import session to stamp.
    importSession: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/strava-token', () => ({
  getValidStravaToken: jest.fn(),
}));

jest.mock('../lib/garmin-token', () => ({
  getValidGarminToken: jest.fn(),
}));

jest.mock('../lib/garmin-activity-details', () => ({
  fetchGarminActivityFromCallback: jest.fn().mockResolvedValue(null),
}));

jest.mock('../lib/ride-stream-store', () => ({
  persistGarminStream: jest.fn().mockResolvedValue(false),
}));

jest.mock('../lib/garmin-ride-removal', () => ({
  removeGarminRideIfPresent: jest.fn().mockResolvedValue(false),
}));

jest.mock('../lib/whoop-token', () => ({
  getValidWhoopToken: jest.fn(),
}));

jest.mock('../lib/suunto-token', () => ({
  getValidSuuntoToken: jest.fn(),
}));

jest.mock('../lib/queue/notification.queue', () => ({
  enqueueReceiptCheck: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/notification.service', () => ({
  fireRideNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/location', () => ({
  deriveLocation: jest.fn().mockReturnValue('Derived Location'),
  // The Garmin upsert path reverse-geocodes through the async variant.
  deriveLocationAsync: jest.fn().mockResolvedValue('Derived Location'),
  shouldApplyAutoLocation: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../config/env', () => ({
  config: {
    garminVerificationMode: false,
    garminApiBase: 'https://apis.garmin.com/wellness-api',
  },
}));

// Mock global fetch
global.fetch = jest.fn();

import { createSyncWorker, closeSyncWorker } from './sync.worker';
import { Worker } from 'bullmq';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import { prisma } from '../lib/prisma';
import { getValidStravaToken } from '../lib/strava-token';
import { getValidGarminToken } from '../lib/garmin-token';
import { fetchGarminActivityFromCallback } from '../lib/garmin-activity-details';
import { config } from '../config/env';
import { persistGarminStream } from '../lib/ride-stream-store';
import { removeGarminRideIfPresent } from '../lib/garmin-ride-removal';
import { getValidWhoopToken } from '../lib/whoop-token';
import { getValidSuuntoToken } from '../lib/suunto-token';

const MockedWorker = Worker as jest.MockedClass<typeof Worker>;
const mockAcquireLock = acquireLock as jest.MockedFunction<typeof acquireLock>;
const mockReleaseLock = releaseLock as jest.MockedFunction<typeof releaseLock>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetValidStravaToken = getValidStravaToken as jest.MockedFunction<typeof getValidStravaToken>;
const mockGetValidWhoopToken = getValidWhoopToken as jest.MockedFunction<typeof getValidWhoopToken>;
const mockGetValidGarminToken = getValidGarminToken as jest.MockedFunction<typeof getValidGarminToken>;
const mockFetchFromCallback = fetchGarminActivityFromCallback as jest.MockedFunction<
  typeof fetchGarminActivityFromCallback
>;
// Mutable so the verification-mode cases can flip it; reset in beforeEach.
const mockConfig = config as unknown as { garminVerificationMode: boolean };
const mockPersistGarminStream = persistGarminStream as jest.MockedFunction<
  typeof persistGarminStream
>;
const mockRemoveGarminRide = removeGarminRideIfPresent as jest.MockedFunction<
  typeof removeGarminRideIfPresent
>;
const mockGetValidSuuntoToken = getValidSuuntoToken as jest.MockedFunction<typeof getValidSuuntoToken>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// The Suunto code path calls `suuntoApiHeaders()` which throws if
// SUUNTO_SUBSCRIPTION_KEY is unset. Local dev machines usually have it via
// .env, but CI / fresh clones don't — so set it explicitly here to keep the
// test deterministic. Mirrors the pattern in suunto.backfill.test.ts.
const originalSuuntoSubscriptionKey = process.env.SUUNTO_SUBSCRIPTION_KEY;
beforeAll(() => {
  process.env.SUUNTO_SUBSCRIPTION_KEY = 'test-subscription-key';
});
afterAll(() => {
  if (originalSuuntoSubscriptionKey === undefined) {
    delete process.env.SUUNTO_SUBSCRIPTION_KEY;
  } else {
    process.env.SUUNTO_SUBSCRIPTION_KEY = originalSuuntoSubscriptionKey;
  }
});

describe('createSyncWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeSyncWorker();
  });

  it('should create a worker with correct queue name', () => {
    createSyncWorker();

    expect(MockedWorker).toHaveBeenCalledWith(
      'sync',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('should return the same worker on subsequent calls', () => {
    const worker1 = createSyncWorker();
    const worker2 = createSyncWorker();

    expect(worker1).toBe(worker2);
    expect(MockedWorker).toHaveBeenCalledTimes(1);
  });

  it('should set up event handlers', () => {
    const mockOn = jest.fn();
    MockedWorker.mockImplementation(() => ({
      on: mockOn,
      close: jest.fn().mockResolvedValue(undefined),
    }) as never);

    createSyncWorker();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('closeSyncWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the worker if it exists', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    MockedWorker.mockImplementation(() => ({
      on: jest.fn(),
      close: mockClose,
    }) as never);

    createSyncWorker();
    await closeSyncWorker();

    expect(mockClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeSyncWorker();
    await closeSyncWorker();
    // No error thrown
  });
});

describe('processSyncJob (via worker processor)', () => {
  let processSyncJob: (job: { name: string; data: { userId: string; provider: string; activityId?: string } }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    // config is a module singleton, so a case that flips this would otherwise
    // leak into every later describe.
    mockConfig.garminVerificationMode = false;

    MockedWorker.mockImplementation((queueName, processor) => {
      processSyncJob = processor as typeof processSyncJob;
      return {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as never;
    });

    createSyncWorker();
  });

  afterEach(async () => {
    await closeSyncWorker();
  });

  describe('lock handling', () => {
    it('should throw DelayedError when lock cannot be acquired', async () => {
      mockAcquireLock.mockResolvedValue({ acquired: false, redisAvailable: true });

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'strava' },
        })
      ).rejects.toThrow('Lock not available');
    });

    it('should acquire and release lock on success', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'strava' },
      });

      expect(mockAcquireLock).toHaveBeenCalledWith('sync', 'strava', 'user123');
      expect(mockReleaseLock).toHaveBeenCalledWith('lock:strava:user123', 'value123');
    });

    it('should release lock even on error', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidStravaToken.mockResolvedValue(null);

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'strava' },
        })
      ).rejects.toThrow('No valid Strava token available');

      expect(mockReleaseLock).toHaveBeenCalledWith('lock:strava:user123', 'value123');
    });
  });

  describe('syncLatest job', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
    });

    it('should sync Strava activities', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 123,
            name: 'Morning Ride',
            sport_type: 'Ride',
            start_date: '2024-01-01T10:00:00Z',
            moving_time: 3600,
            distance: 10000,
            total_elevation_gain: 100,
          },
        ]),
      } as Response);

      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });

      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'strava' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('strava.com/api/v3/athlete/activities'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token',
          }),
        })
      );
    });

    // device_name is not on the list response, so a new ride needs one detailed
    // lookup to capture the recording device (attributes Garmin-recorded rides).
    it('fetches device_name once for a newly-imported Strava ride', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 123, name: 'Ride', sport_type: 'Ride', start_date: '2024-01-01T10:00:00Z', moving_time: 3600, distance: 10000, total_elevation_gain: 100 },
          ]),
      } as Response);
      (mockPrisma.ride.findMany as jest.Mock).mockResolvedValue([]); // none imported yet
      mockPrisma.$transaction.mockImplementation(async (cb) =>
        cb({
          ride: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 }) },
          component: { updateMany: jest.fn() },
        })
      );
      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({ name: 'syncLatest', data: { userId: 'user123', provider: 'strava' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v3/activities/123'),
        expect.anything()
      );
    });

    // Regression: an already-imported ride must NOT trigger a per-activity
    // detail call on every "sync now". device_name is never on the list, so an
    // unconditional fetch would burn one Strava request per ride, every sync.
    it('does not re-fetch device_name for an already-imported Strava ride', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 123, name: 'Ride', sport_type: 'Ride', start_date: '2024-01-01T10:00:00Z', moving_time: 3600, distance: 10000, total_elevation_gain: 100 },
          ]),
      } as Response);
      (mockPrisma.ride.findMany as jest.Mock).mockResolvedValue([{ stravaActivityId: '123' }]); // already imported
      mockPrisma.$transaction.mockImplementation(async (cb) =>
        cb({
          ride: {
            findUnique: jest.fn().mockResolvedValue({ id: 'ride-1', durationSeconds: 3600, bikeId: null, location: null }),
            upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 }),
          },
          component: { updateMany: jest.fn() },
        })
      );
      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({ name: 'syncLatest', data: { userId: 'user123', provider: 'strava' } });

      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/v3/activities/123'),
        expect.anything()
      );
    });

    // The upsert's update block spreads stravaDeviceName only when present. A
    // routine re-sync (existing ride, list has no device_name) must NOT put
    // stravaDeviceName in the update — that omission is what stops a device
    // captured earlier (e.g. a Garmin attribution) from being silently blanked.
    it('omits stravaDeviceName from the update when Strava reports no device', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 123, name: 'Ride', sport_type: 'Ride', start_date: '2024-01-01T10:00:00Z', moving_time: 3600, distance: 10000, total_elevation_gain: 100 },
          ]),
      } as Response);
      (mockPrisma.ride.findMany as jest.Mock).mockResolvedValue([{ stravaActivityId: '123' }]); // existing → no device fetch

      const upsertSpy = jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 });
      mockPrisma.$transaction.mockImplementation(async (cb) =>
        cb({
          ride: {
            findUnique: jest.fn().mockResolvedValue({ id: 'ride-1', durationSeconds: 3600, bikeId: null, location: null }),
            upsert: upsertSpy,
          },
          component: { updateMany: jest.fn() },
        })
      );
      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({ name: 'syncLatest', data: { userId: 'user123', provider: 'strava' } });

      const [upsertArg] = upsertSpy.mock.calls[0];
      expect('stravaDeviceName' in upsertArg.update).toBe(false);
      // create still sets an explicit null (the column is never left unset).
      expect(upsertArg.create.stravaDeviceName).toBeNull();
    });

    it('should throw when Strava token is not available', async () => {
      mockGetValidStravaToken.mockResolvedValue(null);

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'strava' },
        })
      ).rejects.toThrow('No valid Strava token available');
    });

    it('should sync Garmin activities', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:garmin:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidGarminToken.mockResolvedValue('valid-garmin-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'garmin' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('garmin'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-garmin-token',
          }),
        })
      );
    });

    it('should throw when Garmin token is not available', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:garmin:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidGarminToken.mockResolvedValue(null);

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'garmin' },
        })
      ).rejects.toThrow('No valid Garmin token available');
    });

    it('should sync Suunto workouts', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:suunto:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidSuuntoToken.mockResolvedValue('valid-suunto-token');
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ payload: [], metadata: {} }),
      } as Response);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'suunto' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cloudapi.suunto.com/v3/workouts'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-suunto-token',
          }),
        })
      );
      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('should sync WHOOP workouts', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:whoop:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidWhoopToken.mockResolvedValue('valid-whoop-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [],
          next_token: undefined,
        }),
      } as Response);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'whoop' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.prod.whoop.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-whoop-token',
          }),
        })
      );
    });

    it('should throw when WHOOP token is not available', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:whoop:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidWhoopToken.mockResolvedValue(null);

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'whoop' },
        })
      ).rejects.toThrow('No valid WHOOP token available');
    });

    it('should filter WHOOP workouts to cycling only', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:whoop:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidWhoopToken.mockResolvedValue('valid-whoop-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [
            {
              id: 1,
              user_id: 123,
              start: '2024-01-01T10:00:00Z',
              end: '2024-01-01T11:00:00Z',
              sport_id: 1, // Cycling
              score_state: 'SCORED',
              score: {
                strain: 10,
                average_heart_rate: 140,
                max_heart_rate: 170,
                kilojoule: 500,
                distance_meter: 20000,
              },
            },
            {
              id: 2,
              user_id: 123,
              start: '2024-01-02T10:00:00Z',
              end: '2024-01-02T10:30:00Z',
              sport_id: 0, // Running
              score_state: 'SCORED',
              score: {
                strain: 8,
                average_heart_rate: 150,
              },
            },
          ],
          next_token: undefined,
        }),
      } as Response);

      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'whoop' },
      });

      // Transaction should only be called once for the cycling workout
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should skip unscorable WHOOP workouts', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:whoop:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidWhoopToken.mockResolvedValue('valid-whoop-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [
            {
              id: 1,
              user_id: 123,
              start: '2024-01-01T10:00:00Z',
              end: '2024-01-01T11:00:00Z',
              sport_id: 1, // Cycling
              score_state: 'UNSCORABLE',
            },
          ],
          next_token: undefined,
        }),
      } as Response);

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'whoop' },
      });

      // Transaction should not be called for unscorable workout
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw for unknown provider', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:unknown:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'unknown' },
        })
      ).rejects.toThrow('Unknown provider: unknown');
    });
  });

  describe('syncActivity job', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
    });

    it('should throw when activityId is missing', async () => {
      await expect(
        processSyncJob({
          name: 'syncActivity',
          data: { userId: 'user123', provider: 'strava' },
        })
      ).rejects.toThrow('syncActivity requires activityId');
    });

    it('should sync single Strava activity', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 456,
          name: 'Evening Ride',
          sport_type: 'Ride',
          start_date: '2024-01-01T18:00:00Z',
          moving_time: 1800,
          distance: 5000,
          total_elevation_gain: 50,
        }),
      } as Response);

      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 1800 }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });

      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({
        name: 'syncActivity',
        data: { userId: 'user123', provider: 'strava', activityId: '456' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.strava.com/api/v3/activities/456',
        expect.any(Object)
      );
    });

    it('should skip non-cycling activities', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 789,
          name: 'Morning Run',
          sport_type: 'Run',
          start_date: '2024-01-01T08:00:00Z',
          moving_time: 1800,
          distance: 5000,
          total_elevation_gain: 50,
        }),
      } as Response);

      await processSyncJob({
        name: 'syncActivity',
        data: { userId: 'user123', provider: 'strava', activityId: '789' },
      });

      // Should not call prisma.$transaction for non-cycling activity
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should sync single WHOOP workout', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:whoop:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidWhoopToken.mockResolvedValue('valid-whoop-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 99999,
          user_id: 123,
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T11:00:00Z',
          sport_id: 1, // Cycling
          score_state: 'SCORED',
          score: {
            strain: 12,
            average_heart_rate: 145,
            max_heart_rate: 175,
            distance_meter: 25000,
            altitude_gain_meter: 300,
          },
        }),
      } as Response);

      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      await processSyncJob({
        name: 'syncActivity',
        data: { userId: 'user123', provider: 'whoop', activityId: '99999' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.prod.whoop.com/developer/v2/activity/workout/99999',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-whoop-token',
          }),
        })
      );
    });

    it('should skip non-cycling WHOOP workout', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:whoop:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidWhoopToken.mockResolvedValue('valid-whoop-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 88888,
          user_id: 123,
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T10:30:00Z',
          sport_id: 0, // Running
          score_state: 'SCORED',
        }),
      } as Response);

      await processSyncJob({
        name: 'syncActivity',
        data: { userId: 'user123', provider: 'whoop', activityId: '88888' },
      });

      // Should not call prisma.$transaction for non-cycling workout
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

    /**
     * Regression pins for the bug that left every Garmin ride without a map.
     *
     * `/rest/activities` is the Activity SUMMARY: stats, device, start coords,
     * and no per-point data at all. GPS lives only in Activity Details. The
     * worker pulled the summary and handed it straight to persistGarminStream,
     * which looks for `samples`, so the check always failed, no RideStream was
     * ever written, and rideTrack resolved UNAVAILABLE for every Garmin ride.
     */
    describe('Garmin activity details', () => {
      const GARMIN_SUMMARY = {
        summaryId: 'summary-456',
        activityType: 'MOUNTAIN_BIKING',
        startTimeInSeconds: 1706123456,
        durationInSeconds: 5340,
        distanceInMeters: 8368,
        startingLatitudeInDegrees: 48.75,
        startingLongitudeInDegrees: -122.48,
      };

      beforeEach(() => {
        mockAcquireLock.mockResolvedValue({
          acquired: true,
          lockKey: 'lock:garmin:user123',
          lockValue: 'value123',
          redisAvailable: true,
        });
        mockGetValidGarminToken.mockResolvedValue('valid-garmin-token');
        mockConfig.garminVerificationMode = false;
        mockFetchFromCallback.mockResolvedValue(null);
        // Fresh copy per call: the worker mutates the object it parsed, and
        // handing back one shared literal would let one test leak into the next.
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ ...GARMIN_SUMMARY }),
        } as Response);
        (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);
        (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);
        (mockPrisma.ride.upsert as jest.Mock).mockResolvedValue({
          id: 'ride-1',
          bikeId: null,
          durationSeconds: 5340,
        });
      });

      const CALLBACK_URL = 'https://apis.garmin.com/wellness-api/rest/activityDetails?x=1';

      // PUSH is the mode the integration targets. Garmin sent the activity, so
      // there is nothing to request, and a delivery we never answer cannot be
      // scored as an unprompted pull or an unanswered ping.
      it('makes no request at all when the activity was pushed', async () => {
        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY },
          },
        });

        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockFetchFromCallback).not.toHaveBeenCalled();
        expect(mockPrisma.ride.upsert).toHaveBeenCalled();
      });

      it('stores the track that came with the pushed activity', async () => {
        const samples = [{ latitudeInDegree: 48.75, longitudeInDegree: -122.48 }];

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY, samples },
          },
        });

        expect(mockPersistGarminStream).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ samples })
        );
      });

      /**
       * One ride, two deliveries. Garmin sends the Activity Summary as
       * "summary-456" and the Activity Details for the same ride as
       * "summary-456-detail". Keying the row on the raw id sent the second
       * delivery looking for a row that did not exist, so it inserted a
       * duplicate: the rider saw the ride twice, the map was attached to the
       * copy, and the copy's hours were counted against their components again.
       */
      it('updates the ride the summary created when its details arrive', async () => {
        (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue({
          id: 'ride-1',
          location: null,
          bikeId: null,
          durationSeconds: 5340,
        });
        const samples = [{ latitudeInDegree: 48.75, longitudeInDegree: -122.48 }];

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456-detail',
            pushedActivity: { ...GARMIN_SUMMARY, summaryId: 'summary-456-detail', samples },
          },
        });

        expect(mockPrisma.ride.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ where: { garminActivityId: 'summary-456' } })
        );

        const keys = (mockPrisma.ride.upsert as jest.Mock).mock.calls.map(
          ([args]) => args.where.garminActivityId
        );
        expect(keys).not.toContain('summary-456-detail');

        // The track belongs on the ride the rider already has.
        expect(mockPersistGarminStream).toHaveBeenCalledWith(
          'ride-1',
          expect.objectContaining({ samples })
        );
      });

      // Garmin sends deviceName "unknown" on manually-edited activities. The
      // guarantee lives at the write (not only in pickGarminActivityFields), so
      // it must hold for a pushed activity, a backfilled one, or any other path
      // into the upsert. A new ride stores null (fallback renders "Garmin").
      it('stores garminDeviceName as null when Garmin reports the "unknown" sentinel', async () => {
        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY, deviceName: 'unknown' },
          },
        });

        const [args] = (mockPrisma.ride.upsert as jest.Mock).mock.calls[0];
        expect(args.create.garminDeviceName).toBeNull();
      });

      it('stores a real Garmin device model as-is', async () => {
        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY, deviceName: 'fenix8' },
          },
        });

        const [args] = (mockPrisma.ride.upsert as jest.Mock).mock.calls[0];
        expect(args.create.garminDeviceName).toBe('fenix8');
      });

      // The original bug: an edit's update payload overwriting a known model. On
      // the "unknown" sentinel, garminDeviceName must be omitted from the update
      // so the model captured on the first sync is preserved, not downgraded.
      it('omits garminDeviceName from the update when Garmin sends "unknown"', async () => {
        (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue({
          id: 'ride-1',
          location: null,
          bikeId: null,
          durationSeconds: 5340,
        });

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY, deviceName: 'unknown' },
          },
        });

        const [args] = (mockPrisma.ride.upsert as jest.Mock).mock.calls[0];
        expect('garminDeviceName' in args.update).toBe(false);
      });

      // Verification mode blocks unprompted pulls. A push is not a pull, so it
      // must keep flowing or a reviewer sees no data at all.
      it('ingests a pushed activity during verification mode', async () => {
        mockConfig.garminVerificationMode = true;

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY },
          },
        });

        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockPrisma.ride.upsert).toHaveBeenCalled();
      });

      /**
       * The rider retyped the activity in Garmin Connect. It was never a ride,
       * so leaving it behind would keep crediting its hours against installed
       * components and inflate every service prediction built on them.
       */
      it('removes an existing ride when the activity is no longer cycling', async () => {
        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY, activityType: 'RUNNING' },
          },
        });

        expect(mockRemoveGarminRide).toHaveBeenCalledWith('user123', 'summary-456');
        // And it must not also be upserted as a ride.
        expect(mockPrisma.ride.upsert).not.toHaveBeenCalled();
      });

      // The other direction the owner asked for: retyped INTO cycling, so it
      // becomes a ride. This already worked, and pins that it keeps working.
      it('imports an activity retyped into cycling', async () => {
        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            pushedActivity: { ...GARMIN_SUMMARY, activityType: 'GRAVEL_CYCLING' },
          },
        });

        expect(mockPrisma.ride.upsert).toHaveBeenCalled();
        expect(mockRemoveGarminRide).not.toHaveBeenCalled();
      });

      // Garmin's Partner Verification counts a pull as prompted only when it
      // matches a callbackURL Garmin issued, and counts a ping we did not
      // follow as unanswered. Composing our own request fails both checks at
      // once, which is what the verification dashboard was reporting.
      it('answers the ping by following its callbackURL', async () => {
        mockFetchFromCallback.mockResolvedValueOnce({ ...GARMIN_SUMMARY });

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            callbackURL: CALLBACK_URL,
          },
        });

        expect(mockFetchFromCallback).toHaveBeenCalledWith({
          accessToken: 'valid-garmin-token',
          summaryId: 'summary-456',
          callbackURL: CALLBACK_URL,
        });
      });

      it('makes no self-composed request when the callback answered', async () => {
        mockFetchFromCallback.mockResolvedValueOnce({ ...GARMIN_SUMMARY });

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            callbackURL: CALLBACK_URL,
          },
        });

        expect(mockFetch).not.toHaveBeenCalled();
      });

      // One prompted request has to carry the stats and the GPS together,
      // otherwise the map needs a second call that verification would flag.
      it('stores the track from the same payload it got the ride from', async () => {
        const samples = [{ latitudeInDegree: 48.75, longitudeInDegree: -122.48 }];
        mockFetchFromCallback.mockResolvedValueOnce({ ...GARMIN_SUMMARY, samples });

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            callbackURL: CALLBACK_URL,
          },
        });

        expect(mockPersistGarminStream).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ samples })
        );
      });

      // A ping without a usable callbackURL leaves no prompted route to the
      // data. The ride still imports, but the request is unprompted, so it is
      // logged as such rather than passing silently.
      it('falls back to a self-composed request when there is no callbackURL', async () => {
        await processSyncJob({
          name: 'syncActivity',
          data: { userId: 'user123', provider: 'garmin', activityId: 'summary-456' },
        });

        expect(mockFetchFromCallback).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/rest/activities/summary-456'),
          expect.anything()
        );
      });

      it('falls back the same way when the callback returns no match', async () => {
        mockFetchFromCallback.mockResolvedValueOnce(null);

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            callbackURL: CALLBACK_URL,
          },
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/rest/activities/summary-456'),
          expect.anything()
        );
      });

      // docs/garmin/ticket-reply.md tells Garmin that unprompted pulls are
      // blocked behind this flag. Before this it guarded manual sync and
      // syncGarminLatest but left the ping path wide open, so a reviewer
      // running verification still saw unprompted pulls next to that claim.
      it('refuses the unprompted fallback during verification mode', async () => {
        mockConfig.garminVerificationMode = true;

        await processSyncJob({
          name: 'syncActivity',
          data: { userId: 'user123', provider: 'garmin', activityId: 'summary-456' },
        });

        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockPrisma.ride.upsert).not.toHaveBeenCalled();
      });

      // Verification mode must not block the compliant path, or a reviewer sees
      // no data flowing at all.
      it('still follows the callbackURL during verification mode', async () => {
        mockConfig.garminVerificationMode = true;
        mockFetchFromCallback.mockResolvedValueOnce({ ...GARMIN_SUMMARY });

        await processSyncJob({
          name: 'syncActivity',
          data: {
            userId: 'user123',
            provider: 'garmin',
            activityId: 'summary-456',
            callbackURL: CALLBACK_URL,
          },
        });

        expect(mockFetchFromCallback).toHaveBeenCalled();
        expect(mockPrisma.ride.upsert).toHaveBeenCalled();
      });
    });

  describe('unknown job type', () => {

    it('should throw for unknown job type', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });

      await expect(
        processSyncJob({
          name: 'unknownJob' as never,
          data: { userId: 'user123', provider: 'strava' },
        })
      ).rejects.toThrow('Unknown sync job type: unknownJob');
    });
  });

  describe('API error handling', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
    });

    it('should throw when Strava API returns error', async () => {
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'strava' },
        })
      ).rejects.toThrow('Strava API error: 401 Unauthorized');
    });

    it('should throw when Garmin API returns error', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:garmin:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidGarminToken.mockResolvedValue('valid-token');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      } as Response);

      await expect(
        processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'garmin' },
        })
      ).rejects.toThrow('Garmin API error: 403 Forbidden');
    });
  });

  describe('Strava cycling activity types', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidStravaToken.mockResolvedValue('valid-token');
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ bikeId: null, durationSeconds: 3600 }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });
      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);
    });

    const cyclingTypes = [
      'Ride',
      'MountainBikeRide',
      'GravelRide',
      'VirtualRide',
      'EBikeRide',
      'EMountainBikeRide',
      'Handcycle',
    ];

    for (const sportType of cyclingTypes) {
      it(`should process ${sportType} activities`, async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 123,
              name: `${sportType} Activity`,
              sport_type: sportType,
              start_date: '2024-01-01T10:00:00Z',
              moving_time: 3600,
              distance: 10000,
              total_elevation_gain: 100,
            },
          ]),
        } as Response);

        await processSyncJob({
          name: 'syncLatest',
          data: { userId: 'user123', provider: 'strava' },
        });

        expect(mockPrisma.$transaction).toHaveBeenCalled();
      });
    }
  });

  describe('bike assignment', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:strava:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });
      mockGetValidStravaToken.mockResolvedValue('valid-token');
    });

    it('should use gear mapping when available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 123,
            sport_type: 'Ride',
            start_date: '2024-01-01T10:00:00Z',
            moving_time: 3600,
            distance: 10000,
            total_elevation_gain: 100,
            gear_id: 'b12345',
          },
        ]),
      } as Response);

      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue({
        bikeId: 'mapped-bike-id',
      });

      let capturedBikeId: string | null = null;
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockImplementation((args) => {
              capturedBikeId = args.create.bikeId;
              return { bikeId: args.create.bikeId, durationSeconds: 3600 };
            }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'strava' },
      });

      expect(capturedBikeId).toBe('mapped-bike-id');
    });

    it('should auto-assign bike when user has exactly one', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            id: 123,
            sport_type: 'Ride',
            start_date: '2024-01-01T10:00:00Z',
            moving_time: 3600,
            distance: 10000,
            total_elevation_gain: 100,
          },
        ]),
      } as Response);

      (mockPrisma.stravaGearMapping.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([{ id: 'single-bike-id' }]);

      let capturedBikeId: string | null = null;
      mockPrisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          ride: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockImplementation((args) => {
              capturedBikeId = args.create.bikeId;
              return { bikeId: args.create.bikeId, durationSeconds: 3600 };
            }),
          },
          component: { updateMany: jest.fn() },
        };
        return cb(tx);
      });

      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'strava' },
      });

      expect(capturedBikeId).toBe('single-bike-id');
    });
  });
});
