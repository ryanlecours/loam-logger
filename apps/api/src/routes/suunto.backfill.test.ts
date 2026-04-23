import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies before imports
const mockGetValidSuuntoToken = jest.fn();
jest.mock('../lib/suunto-token', () => ({
  getValidSuuntoToken: mockGetValidSuuntoToken,
}));

const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockCount = jest.fn();
const mockUpsert = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: {
      findUnique: mockFindUnique,
      findMany: mockFindMany,
      create: mockCreate,
      count: mockCount,
      deleteMany: mockDeleteMany,
    },
    bike: {
      findMany: mockFindMany,
    },
    component: {
      updateMany: mockUpdateMany,
    },
    backfillRequest: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      deleteMany: mockDeleteMany,
    },
    $transaction: mockTransaction,
  },
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockAcquireLock = jest.fn();
const mockReleaseLock = jest.fn();
jest.mock('../lib/rate-limit', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
  // Lock-renewal calls during the long backfill loops — no-op in tests.
  extendLock: jest.fn().mockResolvedValue(true),
  LOCK_TTL: { sync: 300, backfill: 600 },
}));

const mockFindPotentialDuplicates = jest.fn();
jest.mock('../lib/duplicate-detector', () => ({
  findPotentialDuplicates: mockFindPotentialDuplicates,
}));

const mockIncrementBikeComponentHours = jest.fn();
const mockDecrementBikeComponentHours = jest.fn();
jest.mock('../lib/component-hours', () => ({
  incrementBikeComponentHours: mockIncrementBikeComponentHours,
  decrementBikeComponentHours: mockDecrementBikeComponentHours,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import router from './suunto.backfill';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  return layer?.route?.stack?.[layer.route.stack.length - 1]?.handle;
}

async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

// Sample Suunto workouts — activityId 2 = Cycling, 1 = Running, 10 = MTB.
const sampleCyclingWorkout = {
  workoutKey: 'suunto-key-abc',
  activityId: 2,
  startTime: new Date('2024-06-15T10:00:00Z').getTime(),
  totalTime: 3600,
  totalDistance: 25000,
  totalAscent: 300,
  totalDescent: 300,
  startPosition: { x: -79.38, y: 43.65 },
  hrdata: { workoutAvgHR: 145, workoutMaxHR: 175 },
};

const sampleMtbWorkout = {
  ...sampleCyclingWorkout,
  workoutKey: 'suunto-key-mtb',
  activityId: 10,
};

const sampleRunningWorkout = {
  ...sampleCyclingWorkout,
  workoutKey: 'suunto-key-run',
  activityId: 1,
};

describe('suunto.backfill routes', () => {
  const originalSubscriptionKey = process.env.SUUNTO_SUBSCRIPTION_KEY;

  beforeAll(() => {
    // suuntoApiHeaders() throws if this isn't set; the route calls fetch()
    // in tests with a mocked global fetch, but the header builder still runs.
    process.env.SUUNTO_SUBSCRIPTION_KEY = 'test-subscription-key';
  });

  afterAll(() => {
    if (originalSubscriptionKey === undefined) {
      delete process.env.SUUNTO_SUBSCRIPTION_KEY;
    } else {
      process.env.SUUNTO_SUBSCRIPTION_KEY = originalSubscriptionKey;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /suunto/backfill/fetch', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonResponse: unknown;

    beforeEach(() => {
      handler = getHandler('/suunto/backfill/fetch', 'get');
      jsonResponse = undefined;

      mockReq = {
        user: { id: 'user-123' },
        sessionUser: undefined,
        query: { year: 'ytd' },
      };

      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((data) => {
          jsonResponse = data;
          return mockRes;
        }),
      };

      mockGetValidSuuntoToken.mockResolvedValue('valid-token');
      mockFindMany.mockResolvedValue([]); // No bikes by default
      mockFindUnique.mockResolvedValue(null); // No existing rides / YTD checkpoint
      mockUpsert.mockResolvedValue({});
      mockTransaction.mockImplementation(async (fn) => fn({
        ride: { create: mockCreate },
        component: { updateMany: mockUpdateMany },
      }));
      mockCreate.mockResolvedValue({});
      mockAcquireLock.mockResolvedValue({ acquired: true, lockKey: 'lk', lockValue: 'lv' });
      mockReleaseLock.mockResolvedValue(undefined);
      mockFindPotentialDuplicates.mockResolvedValue(null);
      mockIncrementBikeComponentHours.mockResolvedValue(undefined);
    });

    it('should return error if not authenticated', async () => {
      mockReq.user = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(jsonResponse).toMatchObject({ error: 'Not authenticated' });
    });

    it('should return error if lock cannot be acquired', async () => {
      mockAcquireLock.mockResolvedValue({ acquired: false, lockKey: null, lockValue: null });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('already in progress'),
      });
    });

    it('should return error if Suunto token is not available', async () => {
      mockGetValidSuuntoToken.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('Suunto not connected'),
      });
    });

    it('should release the lock even on token-missing error', async () => {
      mockGetValidSuuntoToken.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockReleaseLock).toHaveBeenCalledWith('lk', 'lv');
    });

    it('should call Suunto /v3/workouts with since/until/limit/offset', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleCyclingWorkout] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://cloudapi.suunto.com/v3/workouts'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer valid-token' }),
        })
      );
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('since=');
      expect(fetchUrl).toContain('until=');
      expect(fetchUrl).toContain('limit=100');
      expect(fetchUrl).toContain('offset=0');
    });

    it('should filter non-cycling activities out', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          payload: [sampleCyclingWorkout, sampleRunningWorkout, sampleMtbWorkout],
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        totalWorkouts: 3,
        cyclingWorkouts: 2,
        imported: 2,
      });
    });

    it('should paginate via offset until a page returns fewer than the page limit', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => ({
        ...sampleCyclingWorkout,
        workoutKey: `page1-${i}`,
      }));
      const secondPage = [{ ...sampleCyclingWorkout, workoutKey: 'page2-0' }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ payload: firstPage }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ payload: secondPage }),
        });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondUrl = mockFetch.mock.calls[1][0] as string;
      expect(secondUrl).toContain('offset=100');
      expect(jsonResponse).toMatchObject({ totalWorkouts: 101 });
    });

    it('should skip workouts already present by suuntoWorkoutId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleCyclingWorkout] }),
      });
      // Both backfillRequest.findUnique and ride.findUnique share the mock.
      // First call (YTD checkpoint) → null; second call (existing ride) → hit.
      mockFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing-ride' });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        imported: 0,
        skipped: 1,
      });
    });

    it('should skip cross-provider duplicates and count them', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleCyclingWorkout] }),
      });
      mockFindPotentialDuplicates.mockResolvedValue({ id: 'garmin-ride-matching' });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        imported: 0,
        skipped: 1,
        duplicatesDetected: 1,
      });
    });

    it('should auto-assign bike if user has exactly one', async () => {
      mockFindMany.mockResolvedValue([{ id: 'single-bike-id' }]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleCyclingWorkout] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({ autoAssignedBike: true });
      expect(mockIncrementBikeComponentHours).toHaveBeenCalled();
    });

    it('should not auto-assign bike when user has multiple bikes', async () => {
      mockFindMany.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleCyclingWorkout] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({ autoAssignedBike: false });
      expect(mockIncrementBikeComponentHours).not.toHaveBeenCalled();
    });

    it('should stamp canonical rideType via getSuuntoRideType', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleMtbWorkout] }),
      });

      let createdRideData: Record<string, unknown> | undefined;
      mockTransaction.mockImplementation(async (fn) => fn({
        ride: {
          create: jest.fn().mockImplementation((args) => {
            createdRideData = args.data;
            return {};
          }),
        },
        component: { updateMany: jest.fn() },
      }));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(createdRideData?.rideType).toBe('Mountain Bike');
      expect(createdRideData?.suuntoWorkoutId).toBe('suunto-key-mtb');
    });

    it('should resume YTD from backfilledUpTo checkpoint when completed', async () => {
      const checkpoint = new Date('2024-09-01T00:00:00Z');
      mockFindUnique.mockResolvedValueOnce({
        backfilledUpTo: checkpoint,
        status: 'completed',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      const sinceMatch = fetchUrl.match(/since=(\d+)/);
      expect(sinceMatch).not.toBeNull();
      const sinceMs = Number(sinceMatch![1]);
      // Resume is checkpoint + 1000ms
      expect(sinceMs).toBe(checkpoint.getTime() + 1000);
    });

    it('should short-circuit with an up-to-date message when start >= end', async () => {
      const futureCheckpoint = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockFindUnique.mockResolvedValueOnce({
        backfilledUpTo: futureCheckpoint,
        status: 'completed',
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        totalWorkouts: 0,
        cyclingWorkouts: 0,
        imported: 0,
      });
    });

    it('should reject year out of range', async () => {
      mockReq.query = { year: '1990' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('Year must be between'),
      });
    });

    it('should accept a specific historical year', async () => {
      mockReq.query = { year: '2023' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      const since = Number(fetchUrl.match(/since=(\d+)/)![1]);
      // 2023-01-01 local-time start
      expect(new Date(since).getFullYear()).toBe(2023);
    });

    it('should write a completed BackfillRequest on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [sampleCyclingWorkout] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider_year: { userId: 'user-123', provider: 'suunto', year: 'ytd' } },
          update: expect.objectContaining({ status: 'completed' }),
          create: expect.objectContaining({ provider: 'suunto', status: 'completed' }),
        })
      );
    });

    it('should write a failed BackfillRequest when Suunto API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve('Bad gateway'),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { status: 'failed', updatedAt: expect.any(Date) },
          create: expect.objectContaining({ provider: 'suunto', status: 'failed' }),
        })
      );
    });

    it('should release the lock after a successful run', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ payload: [] }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockReleaseLock).toHaveBeenCalledWith('lk', 'lv');
    });
  });

  describe('GET /suunto/backfill/status', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonResponse: unknown;

    beforeEach(() => {
      handler = getHandler('/suunto/backfill/status', 'get');
      jsonResponse = undefined;

      mockReq = {
        user: { id: 'user-123' },
        sessionUser: undefined,
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((data) => {
          jsonResponse = data;
          return mockRes;
        }),
      };

      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
      mockFindUnique.mockResolvedValue(null);
    });

    it('should return error if not authenticated', async () => {
      mockReq.user = undefined;
      await invokeHandler(handler, mockReq as Request, mockRes as Response);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should query rides filtered by suuntoWorkoutId', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-123',
            suuntoWorkoutId: { not: null },
          }),
        })
      );
    });

    it('should return recent rides and total', async () => {
      const recent = [
        {
          id: 'r1',
          suuntoWorkoutId: 'suunto-key-abc',
          startTime: new Date(),
          rideType: 'Cycling',
          distanceMeters: 25000,
          createdAt: new Date(),
        },
      ];
      mockFindMany.mockResolvedValueOnce(recent);
      mockCount.mockResolvedValue(3);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        recentRides: recent,
        totalRides: 3,
      });
    });
  });

  describe('DELETE /suunto/testing/delete-imported-rides', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonResponse: unknown;

    beforeEach(() => {
      handler = getHandler('/suunto/testing/delete-imported-rides', 'delete');
      jsonResponse = undefined;

      mockReq = {
        user: { id: 'user-123' },
        sessionUser: undefined,
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((data) => {
          jsonResponse = data;
          return mockRes;
        }),
      };

      mockFindMany.mockResolvedValue([]);
      mockDeleteMany.mockResolvedValue({ count: 0 });
      mockDecrementBikeComponentHours.mockResolvedValue(undefined);
      mockTransaction.mockImplementation(async (fn) => fn({
        component: { updateMany: mockUpdateMany },
        ride: { deleteMany: mockDeleteMany },
        backfillRequest: { deleteMany: mockDeleteMany },
      }));
    });

    it('should return error if not authenticated', async () => {
      mockReq.user = undefined;
      await invokeHandler(handler, mockReq as Request, mockRes as Response);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return early when no Suunto rides exist', async () => {
      mockFindMany.mockResolvedValue([]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        deletedRides: 0,
        message: 'No Suunto rides to delete',
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should delete rides and decrement component hours by bike', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', durationSeconds: 3600, bikeId: 'bike-1' },
        { id: 'r2', durationSeconds: 3600, bikeId: 'bike-1' },
        { id: 'r3', durationSeconds: 3600, bikeId: 'bike-2' },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockDecrementBikeComponentHours).toHaveBeenCalledTimes(2);
      expect(jsonResponse).toMatchObject({
        success: true,
        deletedRides: 3,
        adjustedBikes: 2,
      });
    });

    it('should skip component decrement for unassigned rides', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', durationSeconds: 3600, bikeId: null },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockDecrementBikeComponentHours).not.toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        deletedRides: 1,
        adjustedBikes: 0,
      });
    });

    it('should 500 on transaction failure', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', durationSeconds: 3600, bikeId: 'bike-1' },
      ]);
      mockTransaction.mockRejectedValue(new Error('DB error'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
