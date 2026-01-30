// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    userAccount: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    oauthToken: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
  logError: jest.fn(),
}));

jest.mock('../lib/queue/sync.queue', () => ({
  enqueueSyncJob: jest.fn(),
}));

jest.mock('../lib/queue/backfill.queue', () => ({
  enqueueCallbackJob: jest.fn(),
}));

import express, { type Express } from 'express';
import request from 'supertest';
import garminWebhooksRouter from './webhooks.garmin';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { enqueueSyncJob } from '../lib/queue/sync.queue';
import { enqueueCallbackJob } from '../lib/queue/backfill.queue';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockEnqueueSyncJob = enqueueSyncJob as jest.MockedFunction<typeof enqueueSyncJob>;
const mockEnqueueCallbackJob = enqueueCallbackJob as jest.MockedFunction<typeof enqueueCallbackJob>;

describe('Garmin Webhooks', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(garminWebhooksRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /webhooks/garmin/deregistration', () => {
    it('should return 400 for missing deregistrations array', async () => {
      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid deregistration payload' });
    });

    it('should return 400 for non-array deregistrations', async () => {
      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({ deregistrations: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid deregistration payload' });
    });

    it('should return 200 OK for valid deregistration with known user', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
        userId: 'internal-user-123',
        provider: 'garmin',
        providerUserId: 'garmin-user-456',
      });
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [{ userId: 'garmin-user-456' }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should return 200 OK for deregistration with unknown user', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [{ userId: 'unknown-garmin-user' }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle multiple deregistrations', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock)
        .mockResolvedValueOnce({ userId: 'user-1', provider: 'garmin', providerUserId: 'garmin-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'user-3', provider: 'garmin', providerUserId: 'garmin-3' });
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [
            { userId: 'garmin-1' },
            { userId: 'garmin-2' },
            { userId: 'garmin-3' },
          ],
        });

      expect(response.status).toBe(200);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should return 500 on database error', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [{ userId: 'garmin-user' }],
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /webhooks/garmin/permissions', () => {
    it('should return 400 for missing userPermissionsChange array', async () => {
      const response = await request(app)
        .post('/webhooks/garmin/permissions')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid permissions payload' });
    });

    it('should return 400 for non-array userPermissionsChange', async () => {
      const response = await request(app)
        .post('/webhooks/garmin/permissions')
        .send({ userPermissionsChange: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid permissions payload' });
    });

    it('should return 200 OK for valid permissions change with known user', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
        userId: 'internal-user-123',
        provider: 'garmin',
        providerUserId: 'garmin-user-456',
      });

      const response = await request(app)
        .post('/webhooks/garmin/permissions')
        .send({
          userPermissionsChange: [{
            userId: 'garmin-user-456',
            summaryId: 'summary-123',
            permissions: ['ACTIVITY_EXPORT', 'FITNESS_TRACKING'],
            changeTimeInSeconds: 1706123456,
          }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
    });

    it('should return 200 OK for permissions change with unknown user', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .post('/webhooks/garmin/permissions')
        .send({
          userPermissionsChange: [{
            userId: 'unknown-user',
            summaryId: 'summary-123',
            permissions: ['ACTIVITY_EXPORT'],
            changeTimeInSeconds: 1706123456,
          }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
    });

    it('should handle revoked ACTIVITY_EXPORT permission', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
        userId: 'internal-user-123',
        provider: 'garmin',
        providerUserId: 'garmin-user-456',
      });

      const response = await request(app)
        .post('/webhooks/garmin/permissions')
        .send({
          userPermissionsChange: [{
            userId: 'garmin-user-456',
            summaryId: 'summary-123',
            permissions: ['FITNESS_TRACKING'], // ACTIVITY_EXPORT missing
            changeTimeInSeconds: 1706123456,
          }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
    });

    it('should return 500 on database error', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

      const response = await request(app)
        .post('/webhooks/garmin/permissions')
        .send({
          userPermissionsChange: [{
            userId: 'garmin-user',
            summaryId: 'summary-123',
            permissions: ['ACTIVITY_EXPORT'],
            changeTimeInSeconds: 1706123456,
          }],
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /webhooks/garmin/activities-ping', () => {
    describe('requestType: ping', () => {
      it('should return 200 JSON immediately without enqueuing jobs', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ requestType: 'ping', summaryType: 'CONNECT_ACTIVITY' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });
        expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
        expect(mockEnqueueCallbackJob).not.toHaveBeenCalled();
      });

      it('should log ping acknowledgment with summaryType', async () => {
        await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ requestType: 'ping', summaryType: 'CONNECT_ACTIVITY' });

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'garmin_ping_acknowledged',
            summaryType: 'CONNECT_ACTIVITY',
          }),
          expect.stringContaining('Acknowledged ping request')
        );
      });

      it('should handle ping without summaryType', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ requestType: 'ping' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });
      });
    });

    describe('requestType: pull', () => {
      it('should return 200 with empty activities for pull requests', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ requestType: 'pull', summaryType: 'CONNECT_ACTIVITY' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ activities: [], acknowledged: true });
        expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
        expect(mockEnqueueCallbackJob).not.toHaveBeenCalled();
      });

      it('should log pull acknowledgment with summaryType', async () => {
        await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ requestType: 'pull', summaryType: 'CONNECT_ACTIVITY' });

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'garmin_pull_acknowledged',
            summaryType: 'CONNECT_ACTIVITY',
          }),
          expect.stringContaining('Acknowledged pull request')
        );
      });

      it('should handle pull without summaryType', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ requestType: 'pull' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ activities: [], acknowledged: true });
      });
    });

    describe('activityDetails format (PING mode)', () => {
      it('should return 200 immediately and enqueue sync job for known user', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockEnqueueSyncJob.mockResolvedValue({
          status: 'queued',
          jobId: 'syncActivity_garmin_internal-user-123_summary-456',
        });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activityDetails: [{
              userId: 'garmin-user-123',
              userAccessToken: 'token-xyz',
              summaryId: 'summary-456',
              uploadTimestampInSeconds: 1706123456,
            }],
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });

        // Wait a tick for the fire-and-forget promises to resolve
        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).toHaveBeenCalledWith('syncActivity', {
          userId: 'internal-user-123',
          provider: 'garmin',
          activityId: 'summary-456',
        });
      });

      it('should return 200 and skip unknown users', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activityDetails: [{
              userId: 'unknown-garmin-user',
              userAccessToken: 'token-xyz',
              summaryId: 'summary-456',
              uploadTimestampInSeconds: 1706123456,
            }],
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
      });

      it('should handle multiple activity details', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock)
          .mockResolvedValueOnce({ userId: 'user-1' })
          .mockResolvedValueOnce({ userId: 'user-2' });
        mockEnqueueSyncJob.mockResolvedValue({ status: 'queued', jobId: 'job-123' });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activityDetails: [
              { userId: 'garmin-1', userAccessToken: 'token1', summaryId: 'summary-1', uploadTimestampInSeconds: 1706123456 },
              { userId: 'garmin-2', userAccessToken: 'token2', summaryId: 'summary-2', uploadTimestampInSeconds: 1706123457 },
            ],
          });

        expect(response.status).toBe(200);

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).toHaveBeenCalledTimes(2);
      });

      it('should use x-request-id header when provided', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-1' });
        mockEnqueueSyncJob.mockResolvedValue({ status: 'queued', jobId: 'job-123' });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .set('x-request-id', 'custom-request-id-123')
          .send({
            activityDetails: [{
              userId: 'garmin-user',
              userAccessToken: 'token',
              summaryId: 'summary-1',
              uploadTimestampInSeconds: 1706123456,
            }],
          });

        expect(response.status).toBe(200);
      });
    });

    describe('activities format (callback mode)', () => {
      it('should return 200 immediately and enqueue callback job for known user', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockEnqueueCallbackJob.mockResolvedValue({
          status: 'queued',
          jobId: 'processCallback_garmin_internal-user-123_abc123',
        });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activities: [{
              userId: 'garmin-user-123',
              callbackURL: 'https://apis.garmin.com/callback/xyz',
            }],
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueCallbackJob).toHaveBeenCalledWith({
          userId: 'internal-user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/callback/xyz',
        });
      });

      it('should return 200 and skip unknown users for callbacks', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue(null);

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activities: [{
              userId: 'unknown-garmin-user',
              callbackURL: 'https://apis.garmin.com/callback/xyz',
            }],
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueCallbackJob).not.toHaveBeenCalled();
      });

      it('should handle multiple callback activities', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock)
          .mockResolvedValueOnce({ userId: 'user-1' })
          .mockResolvedValueOnce({ userId: 'user-2' });
        mockEnqueueCallbackJob.mockResolvedValue({ status: 'queued', jobId: 'job-123' });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activities: [
              { userId: 'garmin-1', callbackURL: 'https://apis.garmin.com/callback/1' },
              { userId: 'garmin-2', callbackURL: 'https://apis.garmin.com/callback/2' },
            ],
          });

        expect(response.status).toBe(200);

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueCallbackJob).toHaveBeenCalledTimes(2);
      });
    });

    describe('invalid payloads', () => {
      it('should return 400 for empty payload', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid activities payload' });
      });

      it('should return 400 for empty activityDetails array', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ activityDetails: [] });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid activities payload' });
      });

      it('should return 400 for empty activities array', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ activities: [] });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid activities payload' });
      });

      it('should return 400 for non-array activityDetails', async () => {
        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({ activityDetails: 'not-an-array' });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid activities payload' });
      });
    });

    describe('error handling', () => {
      it('should still return 200 even if background processing fails (fire-and-forget pattern)', async () => {
        // With ACK+enqueue pattern, we return 200 immediately and process in background
        // Database errors during background processing are logged but don't affect response
        (mockPrisma.userAccount.findUnique as jest.Mock).mockImplementation(() => {
          throw new Error('DB Error');
        });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activityDetails: [{
              userId: 'garmin-user',
              userAccessToken: 'token',
              summaryId: 'summary-1',
              uploadTimestampInSeconds: 1706123456,
            }],
          });

        // Response is 200 OK because we ACK immediately before processing
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ acknowledged: true });

        // Wait for background processing to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        // Error should be logged via the enqueue failure monitoring
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'garmin_ping_enqueue_failed',
            error: 'DB Error',
          }),
          expect.stringContaining('Failed to enqueue activity job')
        );
      });
    });
  });
});
