import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies before imports
const mockGetValidWhoopToken = jest.fn();
jest.mock('../lib/whoop-token', () => ({
  getValidWhoopToken: mockGetValidWhoopToken,
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

// Mock rate-limit for distributed locking
const mockAcquireLock = jest.fn();
const mockReleaseLock = jest.fn();
jest.mock('../lib/rate-limit', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
}));

// Mock duplicate detector
const mockFindPotentialDuplicates = jest.fn();
jest.mock('../lib/duplicate-detector', () => ({
  findPotentialDuplicates: mockFindPotentialDuplicates,
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import router after mocks
import router from './whoop.backfill';

// Type for Express router layer internals
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

// Helper to get route handler
function getHandler(path: string, method: string): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  return layer?.route?.stack?.[layer.route.stack.length - 1]?.handle;
}

// Helper to invoke handler
async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

// Sample WHOOP workout data (v2 API uses UUID strings for IDs)
const sampleCyclingWorkout = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  user_id: 67890,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:30:00Z',
  start: '2024-01-15T10:00:00Z',
  end: '2024-01-15T11:00:00Z',
  timezone_offset: '-05:00',
  sport_id: 1, // Cycling
  sport_name: 'Cycling',
  score_state: 'SCORED',
  score: {
    strain: 12.5,
    average_heart_rate: 145,
    max_heart_rate: 175,
    kilojoule: 800,
    percent_recorded: 98,
    distance_meter: 25000,
    altitude_gain_meter: 300,
  },
};

const sampleMtbWorkout = {
  ...sampleCyclingWorkout,
  id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
  sport_id: 57, // Mountain Biking
  sport_name: 'Mountain Biking',
};

const sampleRunWorkout = {
  ...sampleCyclingWorkout,
  id: 'c3d4e5f6-a7b8-9012-cdef-345678901234',
  sport_id: 0, // Running
  sport_name: 'Running',
};

describe('whoop.backfill routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /whoop/backfill/fetch', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonResponse: unknown;

    beforeEach(() => {
      handler = getHandler('/whoop/backfill/fetch', 'get');
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

      mockGetValidWhoopToken.mockResolvedValue('valid-token');
      mockFindMany.mockResolvedValue([]); // No bikes by default
      mockFindUnique.mockResolvedValue(null); // No existing rides/backfill requests
      mockUpsert.mockResolvedValue({});
      mockTransaction.mockImplementation(async (fn) => fn({
        ride: { create: mockCreate },
        component: { updateMany: mockUpdateMany },
      }));
      mockCreate.mockResolvedValue({});
      // Lock acquisition succeeds by default
      mockAcquireLock.mockResolvedValue({ acquired: true, lockValue: 'test-lock-value' });
      mockReleaseLock.mockResolvedValue(undefined);
      // No duplicates by default
      mockFindPotentialDuplicates.mockResolvedValue(null);
    });

    it('should return error if not authenticated', async () => {
      mockReq.user = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(jsonResponse).toMatchObject({
        error: 'Not authenticated',
      });
    });

    it('should return error if lock cannot be acquired', async () => {
      mockAcquireLock.mockResolvedValue({ acquired: false });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('already in progress'),
      });
    });

    it('should return error if WHOOP token is not available', async () => {
      mockGetValidWhoopToken.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('WHOOP not connected'),
      });
    });

    it('should fetch workouts from WHOOP API v2', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.prod.whoop.com/developer/v2/activity/workout'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token',
          }),
        })
      );
    });

    it('should filter to cycling workouts only', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout, sampleRunWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        cyclingWorkouts: 1,
        totalWorkouts: 2,
      });
    });

    it('should import cycling workouts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        imported: 1,
      });
    });

    it('should skip existing workouts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
      });
      mockFindUnique.mockResolvedValue({ id: 'existing-ride' }); // Already exists

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        imported: 0,
        skipped: 1,
      });
    });

    it('should skip unscorable workouts', async () => {
      const unscorableWorkout = {
        ...sampleCyclingWorkout,
        id: 99999,
        score_state: 'UNSCORABLE',
        score: undefined,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [unscorableWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        imported: 0,
        skipped: 1,
      });
    });

    it('should auto-assign bike if user has exactly one', async () => {
      mockFindMany.mockResolvedValue([{ id: 'single-bike-id' }]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        autoAssignedBike: true,
      });
    });

    it('should not auto-assign bike if user has multiple bikes', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'bike-1' },
        { id: 'bike-2' },
      ]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        autoAssignedBike: false,
      });
    });

    it('should handle pagination', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [sampleCyclingWorkout],
            next_token: 'page-2-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [{ ...sampleCyclingWorkout, id: 12347 }],
            next_token: undefined,
          }),
        });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(jsonResponse).toMatchObject({
        success: true,
        totalWorkouts: 2,
      });
    });

    it('should validate year parameter', async () => {
      mockReq.query = { year: '1990' }; // Too old

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('Year must be between'),
      });
    });

    it('should accept specific year', async () => {
      mockReq.query = { year: '2023' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toContain('start=2023-01-01');
    });

    it('should track backfill request in database', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider_year: { userId: 'user-123', provider: 'whoop', year: 'ytd' } },
          update: expect.objectContaining({ status: 'completed' }),
          create: expect.objectContaining({ provider: 'whoop', status: 'completed' }),
        })
      );
    });

    it('should handle WHOOP API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should convert distance from meters to miles', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
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

      // 25000 meters * 0.000621371 = ~15.53 miles
      expect(createdRideData?.distanceMiles).toBeCloseTo(15.53, 1);
    });

    it('should convert elevation from meters to feet', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
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

      // 300 meters * 3.28084 = ~984.25 feet
      expect(createdRideData?.elevationGainFeet).toBeCloseTo(984.25, 1);
    });

    it('should calculate duration from start and end times', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [sampleCyclingWorkout],
          next_token: undefined,
        }),
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

      // 1 hour = 3600 seconds
      expect(createdRideData?.durationSeconds).toBe(3600);
    });
  });

  describe('GET /whoop/backfill/status', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonResponse: unknown;

    beforeEach(() => {
      handler = getHandler('/whoop/backfill/status', 'get');
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

      // Reset mocks for this test suite
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
      mockFindUnique.mockResolvedValue(null);
    });

    it('should return error if not authenticated', async () => {
      mockReq.user = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return recent WHOOP rides', async () => {
      const mockRides = [
        {
          id: 'ride-1',
          whoopWorkoutId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          startTime: new Date(),
          rideType: 'Cycling',
          distanceMiles: 15.5,
          createdAt: new Date(),
        },
      ];
      mockFindMany.mockResolvedValueOnce(mockRides);
      mockCount.mockResolvedValue(10);
      mockFindUnique.mockResolvedValue(null); // YTD backfill checkpoint

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        recentRides: mockRides,
        totalWhoopRides: 10,
      });
    });

    it('should query rides with whoopWorkoutId', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-123',
            whoopWorkoutId: { not: null },
          }),
        })
      );
    });
  });

  describe('DELETE /whoop/testing/delete-imported-rides', () => {
    let handler: RequestHandler | undefined;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonResponse: unknown;

    beforeEach(() => {
      handler = getHandler('/whoop/testing/delete-imported-rides', 'delete');
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

      // Reset mocks
      mockFindMany.mockResolvedValue([]);
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockDeleteMany.mockResolvedValue({ count: 0 });

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

    it('should return early if no WHOOP rides exist', async () => {
      mockFindMany.mockResolvedValue([]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        deletedRides: 0,
        message: 'No WHOOP rides to delete',
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should delete WHOOP rides', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'ride-1', durationSeconds: 3600, bikeId: 'bike-1' },
        { id: 'ride-2', durationSeconds: 1800, bikeId: 'bike-1' },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
      expect(jsonResponse).toMatchObject({
        success: true,
        deletedRides: 2,
      });
    });

    it('should decrement component hours for deleted rides', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'ride-1', durationSeconds: 3600, bikeId: 'bike-1' },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUpdateMany).toHaveBeenCalled();
    });

    it('should handle rides without bike assignment', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'ride-1', durationSeconds: 3600, bikeId: null },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
        deletedRides: 1,
        adjustedBikes: 0,
      });
    });

    it('should aggregate hours by bike', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'ride-1', durationSeconds: 3600, bikeId: 'bike-1' },
        { id: 'ride-2', durationSeconds: 3600, bikeId: 'bike-1' },
        { id: 'ride-3', durationSeconds: 3600, bikeId: 'bike-2' },
      ]);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        adjustedBikes: 2,
      });
    });

    it('should handle database errors gracefully', async () => {
      mockFindMany.mockResolvedValue([{ id: 'ride-1', durationSeconds: 3600, bikeId: 'bike-1' }]);
      mockTransaction.mockRejectedValue(new Error('Database error'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
