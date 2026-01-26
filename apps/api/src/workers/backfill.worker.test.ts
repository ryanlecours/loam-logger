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
}));

jest.mock('../lib/rate-limit', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    backfillRequest: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    ride: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    importSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

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
}));

jest.mock('../config/env', () => ({
  config: {
    garminVerificationMode: false,
    garminApiBase: 'https://apis.garmin.com/wellness-api',
  },
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
      mockGetValidGarminToken.mockResolvedValue('valid-token');
      (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.ride.upsert as jest.Mock).mockResolvedValue({});
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
            startLatitudeInDegrees: 37.7749,
            startLongitudeInDegrees: -122.4194,
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
          }),
        })
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
        mockGetValidGarminToken.mockResolvedValue('valid-token');
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

    it('should throw when Garmin token is not available', async () => {
      mockGetValidGarminToken.mockResolvedValue(null);

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
      ).rejects.toThrow('Garmin token expired or not connected');
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

  describe('backfillYear job', () => {
    beforeEach(() => {
      mockAcquireLock.mockResolvedValue({
        acquired: true,
        lockKey: 'lock:backfill:garmin:user-123',
        lockValue: 'value-123',
        redisAvailable: true,
      });
      mockGetValidGarminToken.mockResolvedValue('valid-token');
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

    it('should throw when Garmin token is not available', async () => {
      mockGetValidGarminToken.mockResolvedValue(null);

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
      ).rejects.toThrow('Garmin token expired or not connected');
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

    mockGetValidGarminToken.mockResolvedValue('valid-token');
    (mockPrisma.importSession.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.ride.findUnique as jest.Mock).mockResolvedValue(null);
    mockDeriveLocationAsync.mockResolvedValue({ title: 'Test Location' });
    mockShouldApplyAutoLocation.mockReturnValue(undefined);
  });

  afterEach(async () => {
    await closeBackfillWorker();
  });

  it('should convert meters to miles', async () => {
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

    // 10000m * 0.000621371 = ~6.21371 miles
    const args = capturedArgs as { create: { distanceMiles: number } };
    expect(args.create.distanceMiles).toBeCloseTo(6.21371, 4);
  });

  it('should convert meters to feet for elevation', async () => {
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

    // 100m * 3.28084 = ~328.084 feet
    const args = capturedArgs as { create: { elevationGainFeet: number } };
    expect(args.create.elevationGainFeet).toBeCloseTo(328.084, 2);
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

    // 50m * 3.28084 = ~164.042 feet
    const args = capturedArgs as { create: { elevationGainFeet: number } };
    expect(args.create.elevationGainFeet).toBeCloseTo(164.042, 2);
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

    const args = capturedArgs as { create: { distanceMiles: number; elevationGainFeet: number } };
    expect(args.create.distanceMiles).toBe(0);
    expect(args.create.elevationGainFeet).toBe(0);
  });
});
