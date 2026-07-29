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
    userIntegration: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockDeleteRideStreams = jest.fn();
jest.mock('../lib/ride-stream-store', () => ({
  deleteRideStreamsForProvider: (...args: unknown[]) => mockDeleteRideStreams(...args),
}));

const mockIsActiveSource = jest.fn();
jest.mock('../lib/active-source', () => ({
  isActiveSource: (...args: unknown[]) => mockIsActiveSource(...args),
}));

jest.mock('../lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
  logError: jest.fn(),
  // lib/integration-tokens (pulled in via the revocation path) builds a scoped
  // logger at module load.
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
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
    // Deliberately NO app-level express.json() — production mounts this router
    // before the global parser so the router's own raised body limits apply.
    // Adding one here would mask a regression in those limits.
    app.use(garminWebhooksRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: allow all providers (no active data source preference)
    mockIsActiveSource.mockResolvedValue(true);
    mockDeleteRideStreams.mockResolvedValue(0);
    // Execute interactive-transaction callbacks against the mocked client.
    // A bare jest.fn() would swallow the callback, so assertions about what
    // happens INSIDE the transaction (token revocation, plaintext cleanup)
    // would silently pass without the code ever running.
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(mockPrisma) : []
    );
  });

  // Deregistration and permission changes ACK before doing any work (Garmin
  // requires the 200 within 30s regardless of batch size), so side effects
  // land after the response. Yield to the microtask queue before asserting.
  const flushBackgroundWork = () => new Promise((resolve) => setTimeout(resolve, 20));

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

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [{ userId: 'garmin-user-456' }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });

      await flushBackgroundWork();
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Revocation must destroy the stored credentials, not merely flag the
      // row — a revoked token we can still decrypt is one we are still holding.
      expect(mockPrisma.userIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'internal-user-123', provider: 'GARMIN' },
          data: expect.objectContaining({
            accessTokenEnc: '',
            refreshTokenEnc: null,
            revokedAt: expect.any(Date),
          }),
        })
      );
      // Any leftover plaintext row from before encryption goes too.
      expect(mockPrisma.oauthToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'internal-user-123', provider: 'garmin' },
      });
      // Deregistration must delete the raw Garmin-supplied GPS, not just the
      // connection — see the privacy policy's Garmin section.
      expect(mockDeleteRideStreams).toHaveBeenCalledWith('internal-user-123', 'garmin');
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

      await flushBackgroundWork();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle multiple deregistrations', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock)
        .mockResolvedValueOnce({ userId: 'user-1', provider: 'garmin', providerUserId: 'garmin-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: 'user-3', provider: 'garmin', providerUserId: 'garmin-3' });

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

      await flushBackgroundWork();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    // Previously this asserted a 500. It now asserts the opposite, and that is
    // the point of the change: Garmin counts any non-200 as a failed delivery,
    // so a database problem on our side must not turn into a delivery failure
    // on theirs. We ACK, then log loudly enough to be alerted on.
    it('still ACKs when the database fails, and logs for manual cleanup', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [{ userId: 'garmin-user' }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });

      await flushBackgroundWork();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'garmin_deregistration_failed', error: 'DB Error' }),
        expect.stringContaining('manual cleanup required')
      );
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

    // Same inversion as the deregistration case: a non-200 reads to Garmin as
    // a failed delivery, so our database trouble stays our problem.
    it('still ACKs when the database fails, and logs the failure', async () => {
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

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });

      await flushBackgroundWork();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'garmin_permissions_failed', error: 'DB Error' }),
        expect.stringContaining('sync may still be enabled')
      );
    });

    // The handler used to only log this. Revoking ACTIVITY_EXPORT is the rider
    // withdrawing the grant every Garmin read depends on, so it has to actually
    // stop sync — deleting the tokens makes every sync path fail closed.
    it('disables Garmin sync when ACTIVITY_EXPORT is revoked', async () => {
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
            permissions: ['FITNESS_TRACKING'],
            changeTimeInSeconds: 1706123456,
          }],
        });

      expect(response.status).toBe(200);

      await flushBackgroundWork();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // Not just a log line: the credentials are actually destroyed, so every
      // sync path fails closed on the next token read.
      expect(mockPrisma.userIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accessTokenEnc: '', refreshTokenEnc: null }),
        })
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'garmin_activity_export_revoked' }),
        expect.stringContaining('disabling Garmin sync')
      );
    });

    it('leaves sync enabled while ACTIVITY_EXPORT is still granted', async () => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
        userId: 'internal-user-123',
        provider: 'garmin',
        providerUserId: 'garmin-user-456',
      });

      await request(app)
        .post('/webhooks/garmin/permissions')
        .send({
          userPermissionsChange: [{
            userId: 'garmin-user-456',
            summaryId: 'summary-123',
            permissions: ['ACTIVITY_EXPORT', 'FITNESS_TRACKING'],
            changeTimeInSeconds: 1706123456,
          }],
        });

      await flushBackgroundWork();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
          detailsCallbackURL: undefined,
          uploadTimestampInSeconds: 1706123456,
        });
      });

      // The GPS samples that draw the ride map exist only on Garmin's
      // activityDetails endpoint. Dropping the ping's pointers to it meant the
      // worker re-pulled the summary, found no samples, and every Garmin ride
      // came out with no track.
      it('should forward the details callbackURL to the sync job', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockEnqueueSyncJob.mockResolvedValue({ status: 'queued', jobId: 'job-1' });

        await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activityDetails: [{
              userId: 'garmin-user-123',
              userAccessToken: 'token-xyz',
              summaryId: 'summary-456',
              uploadTimestampInSeconds: 1706123456,
              callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityDetails?x=1',
            }],
          });

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).toHaveBeenCalledWith('syncActivity', {
          userId: 'internal-user-123',
          provider: 'garmin',
          activityId: 'summary-456',
          detailsCallbackURL: 'https://apis.garmin.com/wellness-api/rest/activityDetails?x=1',
          uploadTimestampInSeconds: 1706123456,
        });
      });

      // A backfill of activityDetails answers on this same key with a
      // callbackURL covering a window and no single activity to name. Enqueuing
      // a syncActivity job for it would produce one with no activityId, which
      // the worker rejects.
      it('should route a summaryId-less details callback to the callback queue', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockEnqueueCallbackJob.mockResolvedValue({ status: 'queued', jobId: 'cb-1' });

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activityDetails: [{
              userId: 'garmin-user-123',
              userAccessToken: 'token-xyz',
              callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityDetails?window=1',
            }],
          });

        expect(response.status).toBe(200);
        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueCallbackJob).toHaveBeenCalledWith({
          userId: 'internal-user-123',
          provider: 'garmin',
          callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityDetails?window=1',
        });
        expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
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

      it('should skip sync when user active source is not garmin', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockIsActiveSource.mockResolvedValue(false);

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

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).not.toHaveBeenCalled();
      });

      it('should proceed when activeDataSource is garmin', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockIsActiveSource.mockResolvedValue(true);
        mockEnqueueSyncJob.mockResolvedValue({ status: 'queued', jobId: 'job-123' });

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

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).toHaveBeenCalledTimes(1);
      });

      it('should proceed when activeDataSource is null', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockIsActiveSource.mockResolvedValue(true);
        mockEnqueueSyncJob.mockResolvedValue({ status: 'queued', jobId: 'job-123' });

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

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueSyncJob).toHaveBeenCalledTimes(1);
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

      it('should skip callback when user active source is not garmin', async () => {
        (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
          userId: 'internal-user-123',
        });
        mockIsActiveSource.mockResolvedValue(false);

        const response = await request(app)
          .post('/webhooks/garmin/activities-ping')
          .send({
            activities: [{
              userId: 'garmin-user-123',
              callbackURL: 'https://apis.garmin.com/callback/1',
            }],
          });

        expect(response.status).toBe(200);

        await new Promise(resolve => setImmediate(resolve));

        expect(mockEnqueueCallbackJob).not.toHaveBeenCalled();
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

  // Garmin's production technical review requires accepting 10MB on every
  // notification endpoint and 100MB for Activity. body-parser defaults to
  // 100kb, so without the router's own parsers an oversized delivery 413s and
  // Garmin records a failed delivery. These are the regression guards.
  describe('payload size limits', () => {
    // Padding a valid payload is what actually exercises the parser — a body
    // that fails schema validation would 400 before size ever mattered.
    const padded = (bytes: number) => ({
      activityDetails: [{
        userId: 'garmin-user-456',
        userAccessToken: 'token',
        summaryId: 'summary-123',
        uploadTimestampInSeconds: 1706123456,
        _padding: 'x'.repeat(bytes),
      }],
    });

    beforeEach(() => {
      (mockPrisma.userAccount.findUnique as jest.Mock).mockResolvedValue({
        userId: 'internal-user-123',
        provider: 'garmin',
        providerUserId: 'garmin-user-456',
      });
      mockEnqueueSyncJob.mockResolvedValue({ jobId: 'job-1', status: 'queued' } as never);
    });

    it('accepts an activities-ping body well over body-parser\'s 100kb default', async () => {
      const response = await request(app)
        .post('/webhooks/garmin/activities-ping')
        .send(padded(500_000));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
    });

    it('accepts an activities-ping body over 10MB (Activity allowance is 100MB)', async () => {
      const response = await request(app)
        .post('/webhooks/garmin/activities-ping')
        .send(padded(12 * 1024 * 1024));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ acknowledged: true });
    }, 30_000);

    it('accepts a deregistration body over 100kb', async () => {

      const response = await request(app)
        .post('/webhooks/garmin/deregistration')
        .send({
          deregistrations: [{ userId: 'garmin-user-456' }],
          _padding: 'x'.repeat(500_000),
        });

      expect(response.status).toBe(200);
    });
  });
});
