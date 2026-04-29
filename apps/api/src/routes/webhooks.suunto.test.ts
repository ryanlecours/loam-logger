import type { Request, Response } from 'express';
import { createHmac } from 'crypto';

// Mock dependencies before importing the module under test
const mockUserAccountFindUnique = jest.fn();
const mockRideFindUnique = jest.fn();
const mockRideUpsert = jest.fn();
const mockBikeFindMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    userAccount: { findUnique: mockUserAccountFindUnique },
    ride: { findUnique: mockRideFindUnique, upsert: mockRideUpsert },
    bike: { findMany: mockBikeFindMany },
    $transaction: mockTransaction,
  },
}));

const mockIsActiveSource = jest.fn();
jest.mock('../lib/active-source', () => ({
  isActiveSource: (...args: unknown[]) => mockIsActiveSource(...args),
}));

const mockSyncBikeComponentHours = jest.fn();
jest.mock('../lib/component-hours', () => ({
  syncBikeComponentHours: (...args: unknown[]) => mockSyncBikeComponentHours(...args),
}));

const mockFireRideNotifications = jest.fn();
jest.mock('../services/notification.service', () => ({
  fireRideNotifications: (...args: unknown[]) => mockFireRideNotifications(...args),
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  logError: jest.fn(),
}));

import webhooksSuunto from './webhooks.suunto';

const SECRET = 'test-notification-secret';

function getPostHandler(path: string) {
  const stack = (webhooksSuunto as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }> }).stack;
  const layer = stack.find((l) => l.route?.path === path && l.route?.methods.post);
  return layer?.route?.stack[0]?.handle as ((req: Request, res: Response) => Promise<void>) | undefined;
}

function makeRequest(payload: Record<string, unknown>): Partial<Request> {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf-8');
  const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  return {
    body: rawBody,
    header: ((name: string) => (name === 'X-HMAC-SHA256-Signature' ? signature : undefined)) as Request['header'],
  };
}

function makeResponse() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res;
}

// Wait for the fire-and-forget processing kicked off after the 200 response.
// processWorkoutCreated runs after `res.status(200).send('OK')` returns —
// flushing the microtask queue is enough for the awaits inside it to resolve
// against the synchronous mocks above.
async function flushAsync(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('POST /webhooks/suunto/workouts', () => {
  const originalSecret = process.env.SUUNTO_NOTIFICATION_SECRET;

  beforeAll(() => {
    process.env.SUUNTO_NOTIFICATION_SECRET = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.SUUNTO_NOTIFICATION_SECRET;
    } else {
      process.env.SUUNTO_NOTIFICATION_SECRET = originalSecret;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsActiveSource.mockResolvedValue(true);
    mockUserAccountFindUnique.mockResolvedValue({ userId: 'user-1' });
    mockRideFindUnique.mockResolvedValue(null); // new ride by default
    mockBikeFindMany.mockResolvedValue([]); // 0 active bikes by default
    mockTransaction.mockImplementation(async (fn) => {
      await fn({
        ride: {
          upsert: mockRideUpsert.mockResolvedValue({
            id: 'ride-new-1',
            bikeId: null,
            durationSeconds: 3600,
          }),
        },
      });
    });
  });

  function makeWorkoutPayload(overrides: Record<string, unknown> = {}) {
    return {
      type: 'WORKOUT_CREATED',
      username: 'johndoe',
      workout: {
        workoutKey: 'suunto-key-1',
        activityId: 2, // cycling
        startTime: Date.now(),
        totalTime: 3600,
        totalDistance: 25000,
        totalAscent: 300,
        ...overrides,
      },
    };
  }

  it('fires fireRideNotifications for a new cycling ride', async () => {
    const handler = getPostHandler('/workouts');
    const req = makeRequest(makeWorkoutPayload());
    const res = makeResponse();

    await handler!(req as Request, res as Response);
    await flushAsync();

    expect(mockFireRideNotifications).toHaveBeenCalledTimes(1);
    expect(mockFireRideNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        rideId: 'ride-new-1',
        isNewRide: true,
        isBackfill: false,
      })
    );
  });

  it('fires fireRideNotifications even on update path (function gates on isNewRide internally)', async () => {
    mockRideFindUnique.mockResolvedValue({ id: 'ride-existing-1', durationSeconds: 3000, bikeId: 'bike-1' });
    mockTransaction.mockImplementation(async (fn) => {
      await fn({
        ride: {
          upsert: jest.fn().mockResolvedValue({
            id: 'ride-existing-1',
            bikeId: 'bike-1',
            durationSeconds: 3600,
          }),
        },
      });
    });

    const handler = getPostHandler('/workouts');
    const req = makeRequest(makeWorkoutPayload());
    const res = makeResponse();

    await handler!(req as Request, res as Response);
    await flushAsync();

    expect(mockFireRideNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ isNewRide: false, isBackfill: false })
    );
  });

  it('does not fire notifications for non-cycling activities', async () => {
    const handler = getPostHandler('/workouts');
    const req = makeRequest(makeWorkoutPayload({ activityId: 1 /* running */ }));
    const res = makeResponse();

    await handler!(req as Request, res as Response);
    await flushAsync();

    expect(mockFireRideNotifications).not.toHaveBeenCalled();
  });

  it('does not fire notifications when user is not the active source', async () => {
    mockIsActiveSource.mockResolvedValue(false);
    const handler = getPostHandler('/workouts');
    const req = makeRequest(makeWorkoutPayload());
    const res = makeResponse();

    await handler!(req as Request, res as Response);
    await flushAsync();

    expect(mockFireRideNotifications).not.toHaveBeenCalled();
  });

  it('does not fire notifications when the username is unknown', async () => {
    mockUserAccountFindUnique.mockResolvedValue(null);
    const handler = getPostHandler('/workouts');
    const req = makeRequest(makeWorkoutPayload());
    const res = makeResponse();

    await handler!(req as Request, res as Response);
    await flushAsync();

    expect(mockFireRideNotifications).not.toHaveBeenCalled();
  });

  it('rejects requests with invalid HMAC signatures', async () => {
    const handler = getPostHandler('/workouts');
    const rawBody = Buffer.from(JSON.stringify(makeWorkoutPayload()), 'utf-8');
    const req: Partial<Request> = {
      body: rawBody,
      header: ((name: string) => (name === 'X-HMAC-SHA256-Signature' ? 'deadbeef' : undefined)) as Request['header'],
    };
    const res = makeResponse();

    await handler!(req as Request, res as Response);
    await flushAsync();

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFireRideNotifications).not.toHaveBeenCalled();
  });
});
