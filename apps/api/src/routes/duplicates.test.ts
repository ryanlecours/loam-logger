import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockFindMany = jest.fn();
const mockTransaction = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: {
      findMany: mockFindMany,
      update: mockUpdate,
    },
    $transaction: mockTransaction,
  },
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

import router from './duplicates';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler | undefined {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
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

type TestRide = {
  id: string;
  startTime: Date;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  garminActivityId: string | null;
  stravaActivityId: string | null;
  whoopWorkoutId: string | null;
  suuntoWorkoutId: string | null;
};

function makeRide(overrides: Partial<TestRide> & { id: string }): TestRide {
  return {
    startTime: new Date('2026-03-15T10:00:00Z'),
    durationSeconds: 3600,
    distanceMeters: 25000,
    elevationGainMeters: 400,
    garminActivityId: null,
    stravaActivityId: null,
    whoopWorkoutId: null,
    suuntoWorkoutId: null,
    ...overrides,
  };
}

describe('POST /duplicates/scan', () => {
  let handler: RequestHandler | undefined;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonResponse: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler('/duplicates/scan', 'post');
    jsonResponse = undefined;

    mockReq = { user: { id: 'user-123' }, sessionUser: undefined };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    mockFindMany.mockResolvedValue([]);
    mockTransaction.mockResolvedValue([]);
  });

  it('rejects unauthenticated requests', async () => {
    mockReq.user = undefined;

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('returns 0 duplicates when no rides exist', async () => {
    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('pairs a Garmin ride with a same-day Strava match (regression)', async () => {
    const garmin = makeRide({ id: 'g1', garminActivityId: 'G-100' });
    const strava = makeRide({
      id: 's1',
      stravaActivityId: 'S-100',
      startTime: new Date('2026-03-15T10:05:00Z'),
      distanceMeters: 25100,
    });
    mockFindMany.mockResolvedValue([garmin, strava]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 1 });
    // Earliest ride (garmin) is primary; later same-day ride (strava) is the duplicate.
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('pairs Suunto with Garmin on the same day', async () => {
    const garmin = makeRide({ id: 'g1', garminActivityId: 'G-100' });
    const suunto = makeRide({
      id: 'su1',
      suuntoWorkoutId: 'SU-100',
      startTime: new Date('2026-03-15T10:06:00Z'),
      distanceMeters: 25200,
    });
    mockFindMany.mockResolvedValue([garmin, suunto]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 1 });
  });

  it('pairs Suunto with Strava on the same day', async () => {
    const strava = makeRide({ id: 's1', stravaActivityId: 'S-100' });
    const suunto = makeRide({
      id: 'su1',
      suuntoWorkoutId: 'SU-100',
      startTime: new Date('2026-03-15T10:07:00Z'),
    });
    mockFindMany.mockResolvedValue([strava, suunto]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 1 });
  });

  it('pairs Suunto with WHOOP on the same day', async () => {
    const whoop = makeRide({ id: 'w1', whoopWorkoutId: 'W-100' });
    const suunto = makeRide({
      id: 'su1',
      suuntoWorkoutId: 'SU-100',
      startTime: new Date('2026-03-15T10:08:00Z'),
    });
    mockFindMany.mockResolvedValue([whoop, suunto]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 1 });
  });

  it('links multiple same-day providers to a single earliest primary', async () => {
    const garmin = makeRide({ id: 'g1', garminActivityId: 'G-100' });
    const strava = makeRide({
      id: 's1',
      stravaActivityId: 'S-100',
      startTime: new Date('2026-03-15T10:05:00Z'),
    });
    const suunto = makeRide({
      id: 'su1',
      suuntoWorkoutId: 'SU-100',
      startTime: new Date('2026-03-15T10:10:00Z'),
    });
    mockFindMany.mockResolvedValue([garmin, strava, suunto]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 2 });
  });

  it('does not pair rides with mismatched metrics', async () => {
    const garmin = makeRide({ id: 'g1', garminActivityId: 'G-100' });
    const suunto = makeRide({
      id: 'su1',
      suuntoWorkoutId: 'SU-100',
      distanceMeters: 50000, // far outside the 5%/160m tolerance
    });
    mockFindMany.mockResolvedValue([garmin, suunto]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('does not pair rides from different UTC days', async () => {
    const garmin = makeRide({
      id: 'g1',
      garminActivityId: 'G-100',
      startTime: new Date('2026-03-15T23:59:00Z'),
    });
    const suunto = makeRide({
      id: 'su1',
      suuntoWorkoutId: 'SU-100',
      startTime: new Date('2026-03-16T00:01:00Z'),
    });
    mockFindMany.mockResolvedValue([garmin, suunto]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, duplicatesFound: 0 });
  });

  it('queries only single-provider non-duplicate rides', async () => {
    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-123',
          isDuplicate: false,
          OR: expect.arrayContaining([
            expect.objectContaining({ suuntoWorkoutId: { not: null } }),
            expect.objectContaining({ whoopWorkoutId: { not: null } }),
          ]),
        }),
      })
    );
  });
});
