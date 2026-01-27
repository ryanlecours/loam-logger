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
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    stravaGearMapping: { findUnique: jest.fn() },
    bike: { findMany: jest.fn() },
    ride: { findUnique: jest.fn(), upsert: jest.fn() },
    component: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/strava-token', () => ({
  getValidStravaToken: jest.fn(),
}));

jest.mock('../lib/garmin-token', () => ({
  getValidGarminToken: jest.fn(),
}));

jest.mock('../lib/whoop-token', () => ({
  getValidWhoopToken: jest.fn(),
}));

jest.mock('../lib/location', () => ({
  deriveLocation: jest.fn().mockReturnValue('Derived Location'),
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
import { getValidWhoopToken } from '../lib/whoop-token';

const MockedWorker = Worker as jest.MockedClass<typeof Worker>;
const mockAcquireLock = acquireLock as jest.MockedFunction<typeof acquireLock>;
const mockReleaseLock = releaseLock as jest.MockedFunction<typeof releaseLock>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetValidStravaToken = getValidStravaToken as jest.MockedFunction<typeof getValidStravaToken>;
const mockGetValidWhoopToken = getValidWhoopToken as jest.MockedFunction<typeof getValidWhoopToken>;
const mockGetValidGarminToken = getValidGarminToken as jest.MockedFunction<typeof getValidGarminToken>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

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

    it('should handle suunto provider gracefully', async () => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:suunto:user123',
        lockValue: 'value123',
        redisAvailable: true,
      });

      // Should not throw
      await processSyncJob({
        name: 'syncLatest',
        data: { userId: 'user123', provider: 'suunto' },
      });
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
