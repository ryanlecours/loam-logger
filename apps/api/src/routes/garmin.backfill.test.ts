import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock Prisma
const mockBackfillFindUnique = jest.fn();
const mockBackfillFindMany = jest.fn();
const mockBackfillUpsert = jest.fn();
const mockBackfillUpdateMany = jest.fn();
const mockRideFindMany = jest.fn();
const mockRideCount = jest.fn();
const mockUserAccountFindFirst = jest.fn();
const mockImportSessionFindFirst = jest.fn();
const mockImportSessionCreate = jest.fn();
const mockImportSessionUpdate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    backfillRequest: {
      findUnique: mockBackfillFindUnique,
      findMany: mockBackfillFindMany,
      upsert: mockBackfillUpsert,
      updateMany: mockBackfillUpdateMany,
    },
    ride: {
      findMany: mockRideFindMany,
      count: mockRideCount,
    },
    user: {
      // Import-depth tier gate lookup — default to Pro so existing tests
      // exercise the underlying route behavior.
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        subscriptionTier: 'PRO',
        isFoundingRider: false,
        role: 'FREE',
      }),
    },
    userAccount: {
      findFirst: mockUserAccountFindFirst,
    },
    importSession: {
      findFirst: mockImportSessionFindFirst,
      create: mockImportSessionCreate,
      update: mockImportSessionUpdate,
    },
  },
}));

// Mock garmin-token
const mockGetValidGarminToken = jest.fn();
jest.mock('../lib/garmin-token', () => ({
  getValidGarminToken: mockGetValidGarminToken,
}));

// Mock the background queue used by the batch route
const mockEnqueueBackfillJob = jest.fn();
jest.mock('../lib/queue/backfill.queue', () => ({
  enqueueBackfillJob: mockEnqueueBackfillJob,
}));

// Mock logger
jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
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
    mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-access-token' });
    // Default: no existing backfill
    mockBackfillFindUnique.mockResolvedValue(null);
    mockBackfillUpsert.mockResolvedValue({});
    // Default: no existing import session
    mockImportSessionFindFirst.mockResolvedValue(null);
    mockImportSessionCreate.mockResolvedValue({ id: 'import-session-1' });
    mockImportSessionUpdate.mockResolvedValue({});
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
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'disconnected' });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
      expect(jsonResponse).toMatchObject({
        error: 'Garmin not connected or token expired. Please reconnect your Garmin account.',
      });
    });

    it('should return 400 and ask for a reconnect when the refresh failed', async () => {
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'refresh_failed' });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
    });

    /**
     * A credential we cannot decrypt is our fault, so it must not come back as
     * a 400 telling the rider to reconnect. Beyond blaming them for our
     * problem, a reconnect re-encrypts under whatever key is loaded now, which
     * fixes that one account and leaves the cause in place: the incident would
     * disappear one rider at a time instead of being noticed.
     */
    it('should return 500, not a reconnect prompt, when credentials will not decrypt', async () => {
      mockGetValidGarminToken.mockResolvedValue({ ok: false, reason: 'undecryptable' });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(500);
      expect(JSON.stringify(jsonResponse)).not.toMatch(/reconnect/i);
    });
  });

  describe('Year Validation', () => {
    it('should return 400 for year before minimum allowed (currentYear - 4)', async () => {
      const minYear = new Date().getFullYear() - 4;
      mockReq.query = { year: String(minYear - 1) };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(400);
      expect(jsonResponse).toMatchObject({
        error: expect.stringContaining(`Year must be between ${minYear}`),
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

  describe('Rolling Day Windows', () => {
    it('should request exactly the last 7 days for a 7d window', async () => {
      mockReq.query = { year: '7d' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      const start = Number(/summaryStartTimeInSeconds=(\d+)/.exec(fetchUrl)?.[1]);
      const end = Number(/summaryEndTimeInSeconds=(\d+)/.exec(fetchUrl)?.[1]);
      // Seven days apart, ending now (allow a second of clock drift)
      expect(end - start).toBeCloseTo(7 * 24 * 60 * 60, -1);
      expect(Math.abs(end - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2);
    });

    it('should request the last 30 days for a 30d window rather than the year', async () => {
      mockReq.query = { year: '30d' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      const start = Number(/summaryStartTimeInSeconds=(\d+)/.exec(fetchUrl)?.[1]);
      const jan1Seconds = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      expect(Math.abs(start - thirtyDaysAgo)).toBeLessThanOrEqual(2);
      // Guards the bug this replaced: '30 days' used to expand to Jan 1
      expect(start).not.toBe(jan1Seconds);
    });

    it('should re-run a window whose previous request completed', async () => {
      mockReq.query = { year: '14d' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'completed',
        year: '14d',
        backfilledUpTo: new Date('2026-07-01T00:00:00Z'),
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).not.toBe(409);
      expect(mockFetch).toHaveBeenCalled();
      // The window is measured from now, never from the last checkpoint
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      const start = Number(/summaryStartTimeInSeconds=(\d+)/.exec(fetchUrl)?.[1]);
      const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
      expect(Math.abs(start - fourteenDaysAgo)).toBeLessThanOrEqual(2);
    });

    it('should return 409 when the same window is already in progress', async () => {
      mockReq.query = { year: '7d' };
      mockBackfillFindUnique.mockResolvedValue({
        id: 'bf-1',
        status: 'in_progress',
        year: '7d',
        backfilledUpTo: null,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(statusCode).toBe(409);
      expect(jsonResponse).toMatchObject({ error: 'Backfill already in progress' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not store backfilledUpTo for a window (only YTD is incremental)', async () => {
      mockReq.query = { year: '30d' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const updateCall = mockBackfillUpdateMany.mock.calls[0];
      expect(updateCall[0].data.backfilledUpTo).toBeNull();
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

    it('should handle 409 Conflict (duplicate request to Garmin) as completed', async () => {
      mockReq.query = { year: 'ytd' };
      mockFetch.mockResolvedValue({
        status: 409,
        ok: false,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      // When all chunks return 409, return success with alreadyCompleted flag
      // This indicates the backfill was already done for this date range
      expect(jsonResponse).toMatchObject({
        success: true,
        alreadyCompleted: true,
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
describe('POST /garmin/backfill/batch', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;
  let jsonResponse: unknown;
  let statusCode: number | undefined;

  const queuedPeriods = () =>
    mockEnqueueBackfillJob.mock.calls.map(([job]) => (job as { year: string }).year);

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler('/garmin/backfill/batch', 'post');
    jsonResponse = undefined;
    statusCode = undefined;

    mockReq = { sessionUser: { uid: 'user-123' }, body: {} };
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

    mockImportSessionFindFirst.mockResolvedValue(null);
    mockImportSessionCreate.mockResolvedValue({ id: 'import-session-1' });
    mockBackfillFindMany.mockResolvedValue([]);
    mockBackfillFindUnique.mockResolvedValue(null);
    mockBackfillUpsert.mockResolvedValue({});
    mockEnqueueBackfillJob.mockResolvedValue({ status: 'queued', jobId: 'job-1' });
  });

  it('queues a rolling window', async () => {
    mockReq.body = { years: ['7d'] };

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(queuedPeriods()).toEqual(['7d']);
    expect(jsonResponse).toMatchObject({ success: true });
  });

  it('rejects a period that is neither a window, ytd, nor a valid year', async () => {
    mockReq.body = { years: ['90d'] };

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(400);
    expect(mockEnqueueBackfillJob).not.toHaveBeenCalled();
  });

  it('re-queues a window whose previous run completed', async () => {
    // Only in-flight rows come back from the rolling lookup, so a completed
    // window looks exactly like a fresh one here.
    mockBackfillFindMany.mockResolvedValue([]);
    mockReq.body = { years: ['30d'] };

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(queuedPeriods()).toEqual(['30d']);
  });

  it('skips a window that is already in flight', async () => {
    mockBackfillFindMany.mockResolvedValue([{ year: '30d', status: 'in_progress' }]);
    mockReq.body = { years: ['30d'] };

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(409);
    expect(mockEnqueueBackfillJob).not.toHaveBeenCalled();
  });

  it('queues the free windows while skipping the one in flight', async () => {
    mockBackfillFindMany.mockResolvedValue([{ year: '7d', status: 'in_progress' }]);
    mockReq.body = { years: ['7d', '30d'] };

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(queuedPeriods()).toEqual(['30d']);
    expect(jsonResponse).toMatchObject({ skipped: ['7d'] });
  });

  it('still treats an imported calendar year as finished', async () => {
    const lastYear = String(new Date().getFullYear() - 1);
    mockBackfillFindMany.mockResolvedValue([{ year: lastYear, status: 'completed' }]);
    mockReq.body = { years: [lastYear] };

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(409);
    expect(mockEnqueueBackfillJob).not.toHaveBeenCalled();
  });
});

describe('extractMinStartDate behavior', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;
  const testYear = new Date().getFullYear() - 2; // Use a year within the 4-year window

  beforeEach(() => {
    jest.clearAllMocks();

    const routerStack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> } }> }).stack;
    const layer = routerStack.find(
      (l) => l.route?.path === '/garmin/backfill/fetch' && l.route?.methods?.get
    );
    handler = layer?.route?.stack?.[0]?.handle;

    mockReq = {
      sessionUser: { uid: 'user-123' },
      query: { year: String(testYear) },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockGetValidGarminToken.mockResolvedValue({ ok: true, accessToken: 'valid-token' });
    mockBackfillFindUnique.mockResolvedValue(null);
    mockBackfillUpsert.mockResolvedValue({});
    mockImportSessionFindFirst.mockResolvedValue(null);
    mockImportSessionCreate.mockResolvedValue({ id: 'import-session-1' });
    mockImportSessionUpdate.mockResolvedValue({});
  });

  it('should adjust start date when Garmin returns min start time error', async () => {
    // First chunk fails with min start time error
    mockFetch
      .mockResolvedValueOnce({
        status: 400,
        ok: false,
        text: () => Promise.resolve(JSON.stringify({
          errorMessage: `summaryStartTimeInSeconds must be greater than or equal to min start time of ${testYear}-06-01T00:00:00Z`,
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
