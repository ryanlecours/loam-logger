import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockFindMany = jest.fn();
const mockTransaction = jest.fn();
const mockUpdate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockRideFindUnique = jest.fn();
const mockDeleteMany = jest.fn();
const mockUpdateMany = jest.fn();
const mockExecuteRaw = jest.fn();
const mockRideDelete = jest.fn();
const mockComponentUpdateMany = jest.fn();
const mockTxRideFindMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: {
      findMany: mockFindMany,
      findUnique: mockRideFindUnique,
      update: mockUpdate,
      deleteMany: mockDeleteMany,
      updateMany: mockUpdateMany,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
    $transaction: mockTransaction,
  },
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

// The auto-merge route now invalidates prediction caches and recomputes
// adjusted components; mock both so tests stay Redis/DB-free.
jest.mock('../services/prediction/cache', () => ({
  invalidateBikePrediction: jest.fn().mockResolvedValue(undefined),
}));

// Every route re-derives counters through this one call; the rule itself is
// covered in lib/component-counters.test.ts. Echoes the bikes it was given, as
// the real one includes them in what it returns.
jest.mock('../lib/component-counters', () => ({
  ...jest.requireActual('../lib/component-counters'),
  recomputeCountersForBikes: jest.fn(async (_tx: unknown, opts: { bikeIds: string[] }) => opts.bikeIds),
}));

import router from './duplicates';
import { invalidateBikePrediction } from '../services/prediction/cache';
import { recomputeCountersForBikes } from '../lib/component-counters';

const mockInvalidateBikePrediction = invalidateBikePrediction as jest.Mock;
const mockRecomputeCountersForBikes = recomputeCountersForBikes as jest.Mock;

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
  bikeId?: string | null;
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
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        ride: { update: mockUpdate },
        componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      })
    );
    mockUpdate.mockResolvedValue({});
  });

  it('rejects unauthenticated requests', async () => {
    mockReq.user = undefined;

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  // A flagged ride stops counting. Without a recompute the stored counters kept
  // charging parts for it while the rides list had already dropped it.
  it('flags the duplicate, recomputes its bike and busts the cached prediction', async () => {
    const garmin = makeRide({ id: 'g1', bikeId: 'bike-1', garminActivityId: 'G-100' });
    const strava = makeRide({
      id: 's1',
      bikeId: 'bike-2',
      stravaActivityId: 'S-100',
      startTime: new Date('2026-03-15T10:05:00Z'),
    });
    mockFindMany.mockResolvedValue([garmin, strava]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { isDuplicate: true, duplicateOfId: 'g1' },
    });
    expect(mockRecomputeCountersForBikes).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-123',
      bikeIds: ['bike-2'],
      componentIds: [],
    });
    expect(mockRecomputeCountersForBikes.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockUpdate.mock.invocationCallOrder[0]
    );
    expect(mockInvalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-2');
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

describe('POST /duplicates/auto-merge', () => {
  let handler: RequestHandler | undefined;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonResponse: unknown;

  type DupRow = TestRide & { duplicateOfId: string | null };

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler('/duplicates/auto-merge', 'post');
    jsonResponse = undefined;

    mockReq = { user: { id: 'user-123' }, sessionUser: undefined };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    // Transaction runs the callback against a tx object exposing the same shape
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        $executeRaw: mockExecuteRaw,
        ride: { deleteMany: mockDeleteMany, updateMany: mockUpdateMany, findMany: mockTxRideFindMany },
        componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      })
    );
    mockExecuteRaw.mockResolvedValue(undefined);
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockTxRideFindMany.mockResolvedValue([]);
  });

  function seedRides(preferred: string, dups: DupRow[], primaries: TestRide[]) {
    mockUserFindUnique.mockResolvedValue({ activeDataSource: preferred });
    // First findMany call = duplicates; second = primaries.
    mockFindMany
      .mockResolvedValueOnce(dups)
      .mockResolvedValueOnce(primaries);
  }

  it('rejects unauthenticated requests', async () => {
    mockReq.user = undefined;

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('rejects when activeDataSource is null', async () => {
    mockUserFindUnique.mockResolvedValue({ activeDataSource: null });

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(jsonResponse).toMatchObject({ error: expect.stringContaining('No active data source') });
  });

  it('rejects non-fitness activeDataSource (apple/google)', async () => {
    mockUserFindUnique.mockResolvedValue({ activeDataSource: 'google' });

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(jsonResponse).toMatchObject({ error: expect.stringContaining('fitness provider') });
  });

  it('returns 0 when there are no duplicate rides', async () => {
    mockUserFindUnique.mockResolvedValue({ activeDataSource: 'suunto' });
    mockFindMany.mockResolvedValueOnce([]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, merged: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('keeps Suunto and deletes the Garmin primary when Suunto is preferred', async () => {
    const dup: DupRow = {
      ...makeRide({ id: 'su-dup', suuntoWorkoutId: 'SU-1' }),
      duplicateOfId: 'g-primary',
    };
    const primary: TestRide = makeRide({ id: 'g-primary', garminActivityId: 'G-1' });
    seedRides('suunto', [dup], [primary]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, merged: 1, preferredSource: 'suunto' });
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['g-primary'] } } });
  });

  it('keeps WHOOP and deletes the Strava primary when WHOOP is preferred', async () => {
    const dup: DupRow = {
      ...makeRide({ id: 'w-dup', whoopWorkoutId: 'W-1' }),
      duplicateOfId: 's-primary',
    };
    const primary: TestRide = makeRide({ id: 's-primary', stravaActivityId: 'S-1' });
    seedRides('whoop', [dup], [primary]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, merged: 1, preferredSource: 'whoop' });
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s-primary'] } } });
  });

  it('deletes the duplicate when neither side matches the preferred provider', async () => {
    const dup: DupRow = {
      ...makeRide({ id: 's-dup', stravaActivityId: 'S-1' }),
      duplicateOfId: 'g-primary',
    };
    const primary: TestRide = makeRide({ id: 'g-primary', garminActivityId: 'G-1' });
    seedRides('suunto', [dup], [primary]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ success: true, merged: 1 });
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s-dup'] } } });
  });

  // Production drift (2026-10-26): the raw hoursUsed decrement left
  // hoursSinceService, which predictions read, 83h too high on every part.
  it('recomputes the affected bikes instead of decrementing hoursUsed by hand', async () => {
    const dup: DupRow = {
      ...makeRide({ id: 's-dup', bikeId: 'bike-1', stravaActivityId: 'S-1', durationSeconds: 7200 }),
      duplicateOfId: 'g-primary',
    };
    const primary: TestRide = makeRide({ id: 'g-primary', bikeId: 'bike-1', garminActivityId: 'G-1' });
    seedRides('garmin', [dup], [primary]);
    // A flagged ride on another bike is cleared too, so that bike counts it again.
    mockTxRideFindMany.mockResolvedValue([{ bikeId: 'bike-1' }, { bikeId: 'bike-2' }]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockTxRideFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-123', isDuplicate: true },
      select: { bikeId: true },
      distinct: ['bikeId'],
    });
    expect(mockRecomputeCountersForBikes).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-123',
      bikeIds: ['bike-1', 'bike-2'],
      legacyHoursDelta: new Map([['bike-1', -2]]),
      componentIds: [],
    });
    // The recompute is the last write, after the delete and the flag clears.
    expect(mockRecomputeCountersForBikes.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...mockDeleteMany.mock.invocationCallOrder, ...mockUpdateMany.mock.invocationCallOrder)
    );
    expect(mockInvalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
    expect(mockInvalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-2');
  });

  // The recompute runs inside the merge transaction, so its failure rolls the
  // deletes back with it: report the error and bust nothing.
  it('returns 500 and busts no cache when the recompute fails', async () => {
    const dup: DupRow = {
      ...makeRide({ id: 's-dup', bikeId: 'bike-1', stravaActivityId: 'S-1' }),
      duplicateOfId: 'g-primary',
    };
    const primary: TestRide = makeRide({ id: 'g-primary', bikeId: 'bike-1', garminActivityId: 'G-1' });
    seedRides('garmin', [dup], [primary]);
    mockRecomputeCountersForBikes.mockRejectedValueOnce(new Error('tx timeout'));

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockInvalidateBikePrediction).not.toHaveBeenCalled();
  });

  it('labels the success message with the correct provider name', async () => {
    mockUserFindUnique.mockResolvedValue({ activeDataSource: 'whoop' });
    mockFindMany.mockResolvedValueOnce([]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    // Empty-duplicates path returns a simple message, but on success it uses PROVIDER_LABELS.
    // Re-run with a real pair to hit the labeled message.
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        $executeRaw: mockExecuteRaw,
        ride: { deleteMany: mockDeleteMany, updateMany: mockUpdateMany, findMany: mockTxRideFindMany },
        componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      })
    );
    const dup: DupRow = {
      ...makeRide({ id: 'su-dup', suuntoWorkoutId: 'SU-1' }),
      duplicateOfId: 'g-primary',
    };
    const primary: TestRide = makeRide({ id: 'g-primary', garminActivityId: 'G-1' });
    seedRides('suunto', [dup], [primary]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(jsonResponse).toMatchObject({ message: expect.stringContaining('Suunto data') });
  });
});

describe('POST /duplicates/merge', () => {
  let handler: RequestHandler | undefined;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonResponse: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler('/duplicates/merge', 'post');
    jsonResponse = undefined;

    mockReq = {
      user: { id: 'user-123' },
      sessionUser: undefined,
      body: { keepRideId: 'keep-1', deleteRideId: 'del-1' },
    } as Partial<Request>;
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    // tx exposes exactly what the merge path + the real component-hours
    // helpers touch: the adjustment lookup, the bulk component decrement,
    // and the ride delete/update.
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        $executeRaw: jest.fn().mockResolvedValue(0),
        componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
        component: { updateMany: mockComponentUpdateMany, findMany: jest.fn().mockResolvedValue([]) },
        bikeComponentInstall: { findMany: jest.fn().mockResolvedValue([]) },
        serviceLog: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
        ride: { delete: mockRideDelete, update: mockUpdate },
      })
    );
    mockComponentUpdateMany.mockResolvedValue({ count: 1 });
    mockRideDelete.mockResolvedValue({ id: 'del-1' });
    mockUpdate.mockResolvedValue({ id: 'keep-1' });
  });

  function seedPair(deleteRide: {
    bikeId: string | null;
    durationSeconds: number | null;
  }) {
    mockRideFindUnique
      .mockResolvedValueOnce({ userId: 'user-123', duplicateOfId: 'del-1', bikeId: deleteRide.bikeId }) // keepRide
      .mockResolvedValueOnce({
        userId: 'user-123',
        duplicateOfId: 'keep-1',
        ...deleteRide,
      }); // deleteRide
  }

  it('rejects unauthenticated requests', async () => {
    mockReq.user = undefined;

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('recomputes the bike and invalidates the prediction cache when deleting the duplicate', async () => {
    seedPair({ bikeId: 'bike-1', durationSeconds: 3600 });

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    // Duplicate deleted inside the integrity transaction
    expect(mockRideDelete).toHaveBeenCalledWith({ where: { id: 'del-1' } });
    // bike-1's parts are re-derived from the ledger; the deleted ride's hour
    // comes off only the legacy hoursUsed of parts never computed.
    expect(mockRecomputeCountersForBikes).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-123',
      bikeIds: ['bike-1'],
      legacyHoursDelta: new Map([['bike-1', -1]]),
      componentIds: [],
    });
    // Prediction cache busted for the affected bike
    expect(mockInvalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
    expect(jsonResponse).toMatchObject({ success: true, keptRideId: 'keep-1' });
  });

  it('skips hours decrement and cache invalidation for an unassigned deleted ride', async () => {
    seedPair({ bikeId: null, durationSeconds: 3600 });

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRideDelete).toHaveBeenCalledWith({ where: { id: 'del-1' } });
    expect(mockRecomputeCountersForBikes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bikeIds: [] })
    );
    expect(mockInvalidateBikePrediction).not.toHaveBeenCalled();
    expect(jsonResponse).toMatchObject({ success: true });
  });

  it('rejects when the two rides are not marked as duplicates of each other', async () => {
    mockRideFindUnique
      .mockResolvedValueOnce({ userId: 'user-123', duplicateOfId: null })
      .mockResolvedValueOnce({ userId: 'user-123', duplicateOfId: null, bikeId: 'bike-1', durationSeconds: 3600 });

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRideDelete).not.toHaveBeenCalled();
  });

  it('still returns success when post-commit cache invalidation throws', async () => {
    seedPair({ bikeId: 'bike-1', durationSeconds: 3600 });
    // The merge transaction already committed; a cache-bust failure must not
    // turn into a 500 (a retry would 404 on the deleted ride).
    mockInvalidateBikePrediction.mockRejectedValue(new Error('redis down'));

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockRideDelete).toHaveBeenCalledWith({ where: { id: 'del-1' } });
    expect(mockRes.status).not.toHaveBeenCalledWith(500);
    expect(jsonResponse).toMatchObject({ success: true, keptRideId: 'keep-1' });
  });
});

describe('POST /duplicates/mark-not-duplicate', () => {
  let handler: RequestHandler | undefined;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler('/duplicates/mark-not-duplicate', 'post');
    mockReq = {
      user: { id: 'user-123' },
      sessionUser: undefined,
      body: { rideId: 'dup-1' },
    } as Partial<Request>;
    mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        componentRideAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
        ride: { findUnique: mockRideFindUnique, findMany: mockTxRideFindMany, updateMany: mockUpdateMany },
      })
    );
    mockUpdateMany.mockResolvedValue({ count: 2 });
  });

  // Clearing the flag makes the ride count again, so its bike is recomputed.
  it('clears the related flags, recomputes their bikes and busts the cached predictions', async () => {
    mockRideFindUnique.mockResolvedValue({ userId: 'user-123', duplicateOfId: 'primary-1' });
    mockTxRideFindMany.mockResolvedValue([
      { id: 'dup-1', bikeId: 'bike-1' },
      { id: 'dup-2', bikeId: 'bike-2' },
    ]);

    await invokeHandler(handler, mockReq as Request, mockRes as Response);

    expect(mockTxRideFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-123',
        OR: [{ id: 'dup-1' }, { duplicateOfId: 'primary-1' }, { duplicateOfId: 'dup-1' }],
      },
      select: { id: true, bikeId: true },
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-123', id: { in: ['dup-1', 'dup-2'] } },
      data: { isDuplicate: false, duplicateOfId: null },
    });
    expect(mockRecomputeCountersForBikes).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-123',
      bikeIds: ['bike-1', 'bike-2'],
      componentIds: [],
    });
    expect(mockInvalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
    expect(mockInvalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-2');
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
