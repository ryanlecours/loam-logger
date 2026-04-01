import { Request, Response } from 'express';

// Mock dependencies before importing the module
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    ride: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../lib/queue/sync.queue', () => ({
  enqueueSyncJob: jest.fn(),
}));

jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prisma } from '../lib/prisma';
import { enqueueSyncJob } from '../lib/queue/sync.queue';
import { logger } from '../lib/logger';

// Import the router after mocks are set up
import webhooksWhoop from './webhooks.whoop';

describe('WHOOP Webhook Handler', () => {
  // Helper to extract route handlers from the router
  const getRouteHandler = (method: 'get' | 'post', path: string) => {
    const stack = webhooksWhoop.stack;
    const layer = stack.find(
      (l) => l.route?.path === path && l.route?.methods[method]
    );
    return layer?.route?.stack[0]?.handle;
  };

  const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
    query: {},
    body: {},
    ...overrides,
  });

  const mockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /whoop (verification)', () => {
    it('should echo challenge for WHOOP verification', () => {
      const handler = getRouteHandler('get', '/whoop');
      const req = mockRequest({ query: { challenge: 'test-challenge-123' } });
      const res = mockResponse();

      handler!(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('test-challenge-123');
    });

    it('should return 400 if challenge is missing', () => {
      const handler = getRouteHandler('get', '/whoop');
      const req = mockRequest({ query: {} });
      const res = mockResponse();

      handler!(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Missing challenge parameter');
    });
  });

  describe('POST /whoop (event handler)', () => {
    it('should respond immediately with 200 OK', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'workout-uuid-1234',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await handler!(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('OK');
    });

    it('should log warning for invalid payload', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: { user_id: 123456 }, // Missing id and event_type
      });
      const res = mockResponse();

      await handler!(req as Request, res as Response);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.any(Object) }),
        '[WHOOP Webhook] Invalid payload - missing required fields'
      );
    });

    it('should log warning for unknown WHOOP user', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 999999,
          id: 'workout-uuid-1234',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await handler!(req as Request, res as Response);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { whoopUserId: '999999' },
        select: { id: true, activeDataSource: true },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { whoopUserId: 999999 },
        '[WHOOP Webhook] Unknown WHOOP user'
      );
    });

    it('should skip processing when user active source is not whoop', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'new-workout-uuid',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        activeDataSource: 'strava',
      });

      await handler!(req as Request, res as Response);

      expect(enqueueSyncJob).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ activeDataSource: 'strava' }),
        '[WHOOP Webhook] User active source is not WHOOP, skipping'
      );
    });

    it('should proceed when activeDataSource is whoop', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'new-workout-uuid',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        activeDataSource: 'whoop',
      });
      (enqueueSyncJob as jest.Mock).mockResolvedValue(undefined);

      await handler!(req as Request, res as Response);

      expect(enqueueSyncJob).toHaveBeenCalledWith('syncActivity', {
        userId: 'user-123',
        provider: 'whoop',
        activityId: 'new-workout-uuid',
      });
    });

    it('should proceed when activeDataSource is null', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'new-workout-uuid',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        activeDataSource: null,
      });
      (enqueueSyncJob as jest.Mock).mockResolvedValue(undefined);

      await handler!(req as Request, res as Response);

      expect(enqueueSyncJob).toHaveBeenCalledWith('syncActivity', {
        userId: 'user-123',
        provider: 'whoop',
        activityId: 'new-workout-uuid',
      });
    });

    it('should delete ride on workout.deleted event', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'workout-uuid-to-delete',
          event_type: 'workout.deleted',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-123', activeDataSource: null });
      (prisma.ride.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await handler!(req as Request, res as Response);

      expect(prisma.ride.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', whoopWorkoutId: 'workout-uuid-to-delete' },
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ workoutId: 'workout-uuid-to-delete', userId: 'user-123' }),
        '[WHOOP Webhook] Marked workout as deleted'
      );
    });

    it('should log debug when deleting non-existent workout', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'non-existent-workout',
          event_type: 'workout.deleted',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-123', activeDataSource: null });
      (prisma.ride.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await handler!(req as Request, res as Response);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ workoutId: 'non-existent-workout' }),
        '[WHOOP Webhook] Workout not found (may not have been imported)'
      );
    });

    it('should enqueue sync job on workout.created event', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'new-workout-uuid',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-456', activeDataSource: null });
      (enqueueSyncJob as jest.Mock).mockResolvedValue(undefined);

      await handler!(req as Request, res as Response);

      expect(enqueueSyncJob).toHaveBeenCalledWith('syncActivity', {
        userId: 'user-456',
        provider: 'whoop',
        activityId: 'new-workout-uuid',
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ workoutId: 'new-workout-uuid', userId: 'user-456' }),
        '[WHOOP Webhook] Enqueued sync job'
      );
    });

    it('should enqueue sync job on workout.updated event', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'updated-workout-uuid',
          event_type: 'workout.updated',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-789', activeDataSource: null });
      (enqueueSyncJob as jest.Mock).mockResolvedValue(undefined);

      await handler!(req as Request, res as Response);

      expect(enqueueSyncJob).toHaveBeenCalledWith('syncActivity', {
        userId: 'user-789',
        provider: 'whoop',
        activityId: 'updated-workout-uuid',
      });
    });

    it('should log warning for unknown event type', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'workout-uuid',
          event_type: 'workout.unknown' as unknown,
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-123', activeDataSource: null });

      await handler!(req as Request, res as Response);

      expect(logger.warn).toHaveBeenCalledWith(
        { event_type: 'workout.unknown' },
        '[WHOOP Webhook] Unknown event type'
      );
    });

    it('should log error but not throw on processing failure', async () => {
      const handler = getRouteHandler('post', '/whoop');
      const req = mockRequest({
        body: {
          user_id: 123456,
          id: 'workout-uuid',
          event_type: 'workout.created',
          timestamp: '2024-01-15T10:00:00Z',
        },
      });
      const res = mockResponse();

      const testError = new Error('Database connection failed');
      (prisma.user.findUnique as jest.Mock).mockRejectedValue(testError);

      // Should not throw
      await expect(handler!(req as Request, res as Response)).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        { error: testError },
        '[WHOOP Webhook] Processing failed'
      );
    });
  });
});
