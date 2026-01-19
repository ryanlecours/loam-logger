import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock Prisma
const mockBackfillFindUnique = jest.fn();
const mockBackfillUpsert = jest.fn();
const mockBackfillUpdateMany = jest.fn();
const mockRideFindMany = jest.fn();
const mockRideCount = jest.fn();
const mockUserAccountFindFirst = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    backfillRequest: {
      findUnique: mockBackfillFindUnique,
      upsert: mockBackfillUpsert,
      updateMany: mockBackfillUpdateMany,
    },
    ride: {
      findMany: mockRideFindMany,
      count: mockRideCount,
    },
    userAccount: {
      findFirst: mockUserAccountFindFirst,
    },
  },
}));

// Mock garmin-token
const mockGetValidGarminToken = jest.fn();
jest.mock('../lib/garmin-token', () => ({
  getValidGarminToken: mockGetValidGarminToken,
}));

// Mock logger
jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

// Import router after mocks
import router from './garmin.backfill';

// Type for Express router layer internals
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

// Helper to get route handler
function getHandler(path: string, method: 'get' | 'post' = 'get'): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  return layer?.route?.stack?.[0]?.handle;
}

// Helper to invoke handler with proper signature
async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

describe('GET /garmin/backfill/fetch', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;
  let jsonResponse: unknown;
  let statusCode: number | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler('/garmin/backfill/fetch');
    jsonResponse = undefined;
    statusCode = undefined;

    mockReq = {
      sessionUser: { uid: 'user-123' },
      query: {},
    };

    mockRes = {
      status: jest.fn().mockImplementation((code) => {
        statusCode = code;
        return mockRes;
      }),
      json: jest.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    // Default: user has valid token
    mockGetValidGarminToken.mockResolvedValue('valid-access-token');
    // Default: no existing backfill
    mockBackfillFindUnique.mockResolvedValue(null);
    mockBackfillUpsert.mockResolvedValue({});
    // Default: successful Garmin API response
    mockFetch.mockResolvedValue({
      status: 202,
      ok: true,
    });
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.sessionUser = undefined;
      mockReq.user = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(401);
      expect(jsonResponse).toMatchObject({
        error: 'Not authenticated',
      });
    });

    it('should return 400 when Garmin token is not available', async () => {
      mockGetValidGarminToken.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
      expect(jsonResponse).toMatchObject({
        error: 'Garmin not connected or token expired. Please reconnect your Garmin account.',
      });
    });
  });

  describe('Year Validation', () => {
    it('should return 400 for year before 2000', async () => {
      mockReq.query = { year: '1999' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining('Year must be between 2000'),
      });
    });

    it('should return 400 for year in the future', async () => {
      const futureYear = new Date().getFullYear() + 1;
      mockReq.query = { year: String(futureYear) };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
    });

    it('should return 400 for non-numeric year', async () => {
      mockReq.query = { year: 'abc' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
    });
  });

  describe('Duplicate Prevention for Specific Years', () => {
    it('should return 409 when year is already backfilled with completed status', async () => {
      mockReq.query = { year: '2024' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'completed',
        year: '2024',
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(409);
      expect(jsonResponse).toMatchObject({
        error: 'Year already backfilled',
        message: '2024 has already been imported. Garmin data for this year is complete.',
      });
    });

    it('should return 409 when year is in_progress', async () => {
      mockReq.query = { year: '2024' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'in_progress',
        year: '2024',
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(409);
    });

    it('should return 409 when year is pending', async () => {
      mockReq.query = { year: '2024' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'pending',
        year: '2024',
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(409);
    });

    it('should allow retry when previous backfill failed', async () => {
      mockReq.query = { year: '2024' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'failed',
        year: '2024',
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Should not return 409, should proceed with backfill
      expect(statusCode).not.toBe(409);
    });

    it('should allow backfill when no previous request exists', async () => {
      mockReq.query = { year: '2024' };
      mockBackfillFindUnique.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).not.toBe(409);
    });
  });

  describe('Incremental YTD Behavior', () => {
    it('should use Jan 1 as start date for fresh YTD backfill', async () => {
      mockReq.query = { year: 'ytd' };
      mockBackfillFindUnique.mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Check that the fetch was called with dates starting Jan 1
      expect(mockFetch).toHaveBeenCalled();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      // The start timestamp should be around Jan 1 of current year
      const currentYear = new Date().getFullYear();
      const jan1 = new Date(currentYear, 0, 1);
      const jan1Seconds = Math.floor(jan1.getTime() / 1000);
      expect(fetchUrl).toContain(`summaryStartTimeInSeconds=${jan1Seconds}`);
    });

    it('should use backfilledUpTo + 1 second as start date when previous YTD completed', async () => {
      mockReq.query = { year: 'ytd' };
      const previousEndDate = new Date('2024-06-15T12:00:00Z');
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'completed',
        year: 'ytd',
        backfilledUpTo: previousEndDate,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      // Start should be 1 second after previousEndDate
      const expectedStart = Math.floor((previousEndDate.getTime() + 1000) / 1000);
      expect(fetchUrl).toContain(`summaryStartTimeInSeconds=${expectedStart}`);
    });

    it('should return 409 when previous YTD is in_progress', async () => {
      mockReq.query = { year: 'ytd' };
      const previousEndDate = new Date('2024-06-15T12:00:00Z');
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'in_progress',
        year: 'ytd',
        backfilledUpTo: previousEndDate,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Should return 409 and not proceed with backfill
      expect(statusCode).toBe(409);
      expect(jsonResponse).toMatchObject({
        error: 'Backfill already in progress',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should NOT use incremental logic when previous YTD failed', async () => {
      mockReq.query = { year: 'ytd' };
      const previousEndDate = new Date('2024-06-15T12:00:00Z');
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'failed',
        year: 'ytd',
        backfilledUpTo: previousEndDate,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      // Should start from Jan 1, not from backfilledUpTo
      const currentYear = new Date().getFullYear();
      const jan1 = new Date(currentYear, 0, 1);
      const jan1Seconds = Math.floor(jan1.getTime() / 1000);
      expect(fetchUrl).toContain(`summaryStartTimeInSeconds=${jan1Seconds}`);
    });

    it('should NOT use incremental logic when backfilledUpTo is null', async () => {
      mockReq.query = { year: 'ytd' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'completed',
        year: 'ytd',
        backfilledUpTo: null,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      // Should start from Jan 1
      const currentYear = new Date().getFullYear();
      const jan1 = new Date(currentYear, 0, 1);
      const jan1Seconds = Math.floor(jan1.getTime() / 1000);
      expect(fetchUrl).toContain(`summaryStartTimeInSeconds=${jan1Seconds}`);
    });
  });

  describe('Days Parameter (Backward Compatibility)', () => {
    it('should default to 30 days when no parameters provided', async () => {
      mockReq.query = {};

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return 400 for days < 1', async () => {
      mockReq.query = { days: '0' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
      expect(jsonResponse).toMatchObject({
        error: 'Days must be between 1 and 365',
      });
    });

    it('should return 400 for days > 365', async () => {
      mockReq.query = { days: '366' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
    });
  });

  describe('Garmin API Responses', () => {
    it('should handle 202 Accepted (success)', async () => {
      mockReq.query = { year: 'ytd' };
      mockFetch.mockResolvedValue({
        status: 202,
        ok: true,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toMatchObject({
        success: true,
      });
    });

    it('should handle 409 Conflict (duplicate request to Garmin)', async () => {
      mockReq.query = { year: 'ytd' };
      mockFetch.mockResolvedValue({
        status: 409,
        ok: false,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Should return 409 to client
      expect(statusCode).toBe(409);
      expect(jsonResponse).toMatchObject({
        error: 'Backfill already in progress',
      });
    });
  });

  describe('Database Status Updates', () => {
    beforeEach(() => {
      // Default: updateMany returns count of 1 (record was updated)
      mockBackfillUpdateMany.mockResolvedValue({ count: 1 });
    });

    it('should not overwrite completed status (race condition protection)', async () => {
      mockReq.query = { year: 'ytd' };
      mockBackfillFindUnique.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ status: 202, ok: true });
      // Simulate race condition: updateMany returns 0 because status was already 'completed'
      mockBackfillUpdateMany.mockResolvedValue({ count: 0 });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // updateMany should be called with condition to exclude 'completed' status
      expect(mockBackfillUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'completed' },
          }),
        })
      );
    });

    it('should update status to in_progress on successful trigger', async () => {
      mockReq.query = { year: 'ytd' };
      mockBackfillFindUnique.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ status: 202, ok: true });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // Upsert ensures record exists
      expect(mockBackfillUpsert).toHaveBeenCalled();
      // updateMany atomically updates status
      expect(mockBackfillUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'in_progress' }),
        })
      );
    });

    it('should store backfilledUpTo for YTD requests', async () => {
      mockReq.query = { year: 'ytd' };
      mockBackfillFindUnique.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ status: 202, ok: true });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBackfillUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            backfilledUpTo: expect.any(Date),
          }),
        })
      );
    });

    it('should NOT store backfilledUpTo for specific year requests', async () => {
      mockReq.query = { year: '2024' };
      mockBackfillFindUnique.mockResolvedValue(null);
      mockFetch.mockResolvedValue({ status: 202, ok: true });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // For specific years, backfilledUpTo should not be in the data
      expect(mockBackfillUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            backfilledUpTo: expect.any(Date),
          }),
        })
      );
    });
  });
});

// Test the extractMinStartDate helper function by testing its behavior through the API
describe('extractMinStartDate behavior', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;

  beforeEach(() => {
    jest.clearAllMocks();

    const routerStack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }> }).stack;
    const layer = routerStack.find(
      (l) => l.route?.path === '/garmin/backfill/fetch' && l.route?.methods?.get
    );
    handler = layer?.route?.stack?.[0]?.handle;

    mockReq = {
      sessionUser: { uid: 'user-123' },
      query: { year: '2020' },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockGetValidGarminToken.mockResolvedValue('valid-token');
    mockBackfillFindUnique.mockResolvedValue(null);
    mockBackfillUpsert.mockResolvedValue({});
  });

  it('should adjust start date when Garmin returns min start time error', async () => {
    // First chunk fails with min start time error
    mockFetch
      .mockResolvedValueOnce({
        status: 400,
        ok: false,
        text: () => Promise.resolve(JSON.stringify({
          errorMessage: 'summaryStartTimeInSeconds must be greater than or equal to min start time of 2020-06-01T00:00:00Z',
        })),
      })
      // Second chunk succeeds after adjustment
      .mockResolvedValue({
        status: 202,
        ok: true,
      });

    await invokeHandler(handler!, mockReq as Request, mockRes as Response);

    // Should have made multiple fetch calls, adjusting the date
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });
});
