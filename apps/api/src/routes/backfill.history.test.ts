import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock Prisma
const mockFindMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    backfillRequest: {
      findMany: mockFindMany,
    },
  },
}));

// Mock logger
jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

// Import router after mocks
import router from './backfill.history';

// Type for Express router layer internals
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

// Helper to get route handler
function getHandler(): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === '/backfill/history' && l.route?.methods?.get
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

describe('GET /backfill/history', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;
  let jsonResponse: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler();
    jsonResponse = undefined;

    mockReq = {
      sessionUser: { uid: 'user-123' },
      query: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    mockFindMany.mockResolvedValue([]);
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.sessionUser = undefined;
      mockReq.user = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(jsonResponse).toMatchObject({
        error: 'Not authenticated',
        code: 'UNAUTHORIZED',
      });
    });

    it('should accept user from req.user.id', async () => {
      mockReq.sessionUser = undefined;
      mockReq.user = { id: 'user-456' } as Request['user'];

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-456' }),
        })
      );
    });
  });

  describe('Provider Filtering', () => {
    it('should return all requests when no provider filter', async () => {
      mockReq.query = {};

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
    });

    it('should filter by provider when valid provider is given (strava)', async () => {
      mockReq.query = { provider: 'strava' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123', provider: 'strava' },
        })
      );
    });

    it('should filter by provider when valid provider is given (garmin)', async () => {
      mockReq.query = { provider: 'garmin' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123', provider: 'garmin' },
        })
      );
    });

    it('should ignore invalid provider values', async () => {
      mockReq.query = { provider: 'invalid' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
    });

    it('should ignore non-string provider values', async () => {
      mockReq.query = { provider: ['strava', 'garmin'] as unknown as string };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
    });
  });

  describe('Response Format', () => {
    it('should return requests sorted by updatedAt desc', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'desc' },
        })
      );
    });

    it('should select correct fields', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            provider: true,
            year: true,
            status: true,
            ridesFound: true,
            backfilledUpTo: true,
            createdAt: true,
            updatedAt: true,
            completedAt: true,
          },
        })
      );
    });

    it('should return success with requests', async () => {
      const mockRequests = [
        {
          id: 'req-1',
          provider: 'garmin',
          year: '2024',
          status: 'completed',
          ridesFound: 50,
          backfilledUpTo: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        },
        {
          id: 'req-2',
          provider: 'strava',
          year: 'ytd',
          status: 'in_progress',
          ridesFound: null,
          backfilledUpTo: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
        },
      ];
      mockFindMany.mockResolvedValue(mockRequests);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(jsonResponse).toEqual({
        success: true,
        requests: mockRequests,
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on database error', async () => {
      mockFindMany.mockRejectedValue(new Error('Database connection failed'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(jsonResponse).toMatchObject({
        error: 'Failed to fetch backfill history',
        code: 'INTERNAL_ERROR',
      });
    });
  });
});
