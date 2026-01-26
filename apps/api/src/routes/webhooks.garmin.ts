import { Router as createRouter, type Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger, logError } from '../lib/logger';
import { enqueueSyncJob } from '../lib/queue/sync.queue';
import { enqueueCallbackJob } from '../lib/queue/backfill.queue';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Deregistration webhook
 * Called by Garmin when a user disconnects from Garmin Connect or we call DELETE /registration
 * Spec: Garmin Developer Guide Section 2.6.2
 */
r.post<Empty, void, { deregistrations?: Array<{ userId: string }> }>(
  '/webhooks/garmin/deregistration',
  async (req: Request, res: Response) => {
    try {
      const { deregistrations } = req.body;

      if (!deregistrations || !Array.isArray(deregistrations)) {
        logger.warn({ body: req.body }, '[Garmin Deregistration] Invalid payload');
        return res.status(400).json({ error: 'Invalid deregistration payload' });
      }

      logger.info({ count: deregistrations.length }, '[Garmin Deregistration] Received deregistration(s)');

      for (const { userId: garminUserId } of deregistrations) {
        // Find the user by their Garmin User ID
        const userAccount = await prisma.userAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'garmin',
              providerUserId: garminUserId,
            },
          },
        });

        if (!userAccount) {
          logger.warn({ garminUserId }, '[Garmin Deregistration] Unknown Garmin userId');
          continue;
        }

        // Delete OAuth tokens and UserAccount record
        await prisma.$transaction([
          prisma.oauthToken.deleteMany({
            where: {
              userId: userAccount.userId,
              provider: 'garmin',
            },
          }),
          prisma.userAccount.delete({
            where: {
              provider_providerUserId: {
                provider: 'garmin',
                providerUserId: garminUserId,
              },
            },
          }),
        ]);

        logger.info({ userId: userAccount.userId }, '[Garmin Deregistration] Removed Garmin connection');
      }

      // Return 200 OK immediately (Garmin requires this)
      return res.status(200).send('OK');
    } catch (error) {
      logError('Garmin Deregistration', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * User Permissions webhook
 * Called when a user changes their data sharing permissions
 * Spec: Garmin Developer Guide Section 2.6.3
 */
r.post<Empty, void, { userPermissionsChange?: Array<{
  userId: string;
  summaryId: string;
  permissions: string[];
  changeTimeInSeconds: number;
}> }>(
  '/webhooks/garmin/permissions',
  async (req: Request, res: Response) => {
    try {
      const { userPermissionsChange } = req.body;

      if (!userPermissionsChange || !Array.isArray(userPermissionsChange)) {
        logger.warn({ body: req.body }, '[Garmin Permissions] Invalid payload');
        return res.status(400).json({ error: 'Invalid permissions payload' });
      }

      logger.info({ count: userPermissionsChange.length }, '[Garmin Permissions] Received permission change(s)');

      for (const change of userPermissionsChange) {
        const { userId: garminUserId, permissions } = change;

        // Find the user by their Garmin User ID
        const userAccount = await prisma.userAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'garmin',
              providerUserId: garminUserId,
            },
          },
        });

        if (!userAccount) {
          logger.warn({ garminUserId }, '[Garmin Permissions] Unknown Garmin userId');
          continue;
        }

        logger.info({ userId: userAccount.userId, permissions }, '[Garmin Permissions] User permissions');

        // Check if ACTIVITY_EXPORT permission is still granted
        if (!permissions.includes('ACTIVITY_EXPORT')) {
          logger.warn({ userId: userAccount.userId }, '[Garmin Permissions] User revoked ACTIVITY_EXPORT permission');
          // You could notify the user or disable sync here
        }
      }

      // Return 200 OK immediately (Garmin requires this)
      return res.status(200).send('OK');
    } catch (error) {
      logError('Garmin Permissions', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Activity PING webhook (Recommended)
 * Receives notification from Garmin with userId and summaryId (PING mode)
 * We then fetch the full activity details using the Activity API
 * Spec: Garmin Activity API Section 5 (Ping Service)
 *
 * PING mode is preferred because it includes userId in the notification.
 *
 * Garmin sends TWO different payload formats:
 * 1. activityDetails: [{ userId, summaryId, userAccessToken, ... }]
 * 2. activities: [{ userId, callbackURL }] - used for backfill responses
 */
type GarminActivityPing = {
  userId: string;
  userAccessToken: string;
  summaryId: string;
  uploadTimestampInSeconds: number;
  [key: string]: unknown;
};

type GarminActivityCallback = {
  userId: string;
  callbackURL: string;
  [key: string]: unknown;
};

type GarminPingPayload = {
  activityDetails?: GarminActivityPing[];
  activities?: GarminActivityCallback[];
};

r.post<Empty, void, GarminPingPayload>(
  '/webhooks/garmin/activities-ping',
  async (req: Request, res: Response) => {
    // Generate correlation ID for audit trail
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

    // Log incoming webhook request IMMEDIATELY to verify Garmin is hitting this endpoint
    logger.debug({ requestId, headers: req.headers, body: req.body }, '[Garmin PING Webhook] Incoming request');

    try {
      const { activityDetails, activities } = req.body;

      // Handle the "activities" format with callbackURL (used for backfill)
      if (activities && Array.isArray(activities) && activities.length > 0) {
        logger.info({
          event: 'garmin_callback_received',
          requestId,
          count: activities.length,
        }, '[Garmin PING] Received callback notification(s)');

        // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
        res.status(200).send('OK');

        // Fire-and-forget: Enqueue jobs for background processing
        // Using Promise.allSettled to not block on any failures
        const enqueuePromises = activities.map(async (notification) => {
          const { userId: garminUserId, callbackURL } = notification;

          // Fast indexed lookup for internal userId
          const userAccount = await prisma.userAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'garmin',
                providerUserId: garminUserId,
              },
            },
            select: { userId: true },
          });

          if (!userAccount) {
            logger.warn({ requestId, garminUserId }, '[Garmin PING] Unknown Garmin userId for callback');
            return { status: 'skipped', reason: 'unknown_user' };
          }

          const result = await enqueueCallbackJob({
            userId: userAccount.userId,
            provider: 'garmin',
            callbackURL,
          });

          logger.info({
            event: 'garmin_callback_job_enqueued',
            requestId,
            jobId: result.jobId,
            userId: userAccount.userId,
            status: result.status,
          }, '[Garmin PING] Enqueued callback job');

          return { status: result.status, jobId: result.jobId };
        });

        // Non-blocking - don't await, but log completion
        Promise.allSettled(enqueuePromises).then((results) => {
          const queued = results.filter(r => r.status === 'fulfilled').length;
          logger.debug({ requestId, queued, total: results.length }, '[Garmin PING] Callback batch enqueue complete');
        });

        return;
      }

      // Handle the "activityDetails" format with summaryId (PING mode)
      if (activityDetails && Array.isArray(activityDetails) && activityDetails.length > 0) {
        logger.info({
          event: 'garmin_ping_received',
          requestId,
          notificationCount: activityDetails.length,
          summaryIds: activityDetails.map(n => n.summaryId),
        }, '[Garmin PING] Received activity notification(s)');

        // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
        res.status(200).send('OK');

        // Fire-and-forget: Enqueue jobs for background processing
        const enqueuePromises = activityDetails.map(async (notification) => {
          const { userId: garminUserId, summaryId } = notification;

          // Fast indexed lookup for internal userId
          const userAccount = await prisma.userAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'garmin',
                providerUserId: garminUserId,
              },
            },
            select: { userId: true },
          });

          if (!userAccount) {
            logger.warn({ requestId, garminUserId, summaryId }, '[Garmin PING] Unknown Garmin userId');
            return { status: 'skipped', summaryId, reason: 'unknown_user' };
          }

          // Enqueue sync job with deterministic ID for deduplication
          const result = await enqueueSyncJob('syncActivity', {
            userId: userAccount.userId,
            provider: 'garmin',
            activityId: summaryId,
          });

          logger.info({
            event: 'garmin_job_enqueued',
            requestId,
            jobId: result.jobId,
            summaryId,
            userId: userAccount.userId,
            status: result.status,
          }, '[Garmin PING] Enqueued sync job');

          return { status: result.status, summaryId, jobId: result.jobId };
        });

        // Non-blocking - don't await, but log completion
        Promise.allSettled(enqueuePromises).then((results) => {
          const queued = results.filter(r => r.status === 'fulfilled').length;
          logger.debug({ requestId, queued, total: results.length }, '[Garmin PING] Activity batch enqueue complete');
        });

        return;
      }

      // Neither format matched
      logger.warn({ requestId, body: req.body }, '[Garmin PING] Invalid payload');
      return res.status(400).json({ error: 'Invalid activities payload' });
    } catch (error) {
      logError('Garmin Activities PING', error);
      // If we haven't responded yet, send error
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

export default r;
