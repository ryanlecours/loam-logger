import { Router as createRouter, json, type Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger, logError } from '../lib/logger';
import { enqueueSyncJob } from '../lib/queue/sync.queue';
import { enqueueCallbackJob } from '../lib/queue/backfill.queue';
import { isActiveSource } from '../lib/active-source';
import { deleteRideStreamsForProvider } from '../lib/ride-stream-store';
import { revokeIntegration } from '../lib/integration-tokens';
import { flattenGarminActivity } from '../lib/garmin-activity-details';
import {
  isGarminCyclingActivity,
  isPushedGarminActivity,
  type GarminDeliveryEntry,
} from '../types/garmin';

type Empty = Record<string, never>;
const r: Router = createRouter();

// Garmin Connect Developer Program requires every notification endpoint to
// accept payloads up to 10MB, and up to 100MB for Activity. body-parser's
// default is 100kb, so an oversized delivery would 413 — and Garmin counts a
// non-200 as a failed delivery, which fails the production technical review.
//
// These parsers live on the router (rather than raising the global limit in
// server.ts) so the 100MB allowance is confined to the one endpoint that needs
// it instead of becoming a request-body DoS surface on every route. server.ts
// must therefore register this router BEFORE its global express.json().
export const GARMIN_ACTIVITY_BODY_LIMIT = '100mb';
export const GARMIN_BODY_LIMIT = '10mb';

r.use('/webhooks/garmin/activities-ping', json({ limit: GARMIN_ACTIVITY_BODY_LIMIT }));
r.use('/webhooks/garmin', json({ limit: GARMIN_BODY_LIMIT }));

/**
 * Deregistration webhook
 * Called by Garmin when a user disconnects from Garmin Connect or we call DELETE /registration
 * Spec: Garmin Developer Guide Section 2.6.2
 */
r.post<Empty, void, { deregistrations?: Array<{ userId: string }> }>(
  '/webhooks/garmin/deregistration',
  async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const { deregistrations } = req.body;

    if (!deregistrations || !Array.isArray(deregistrations)) {
      logger.warn({ requestId, body: req.body }, '[Garmin Deregistration] Invalid payload');
      return res.status(400).json({ error: 'Invalid deregistration payload' });
    }

    logger.info(
      { requestId, count: deregistrations.length },
      '[Garmin Deregistration] Received deregistration(s)'
    );

    // ACK before doing any work — same fire-and-forget contract as the activity
    // ping handler. A batch deregistration is N user lookups plus N
    // transactions plus a stream delete each; doing that inline risks blowing
    // Garmin's 30-second response window, and a timeout reads to Garmin as a
    // failed delivery. Garmin retries anything we do not 200, so acknowledging
    // first and processing after is both safe and what they ask for.
    res.status(200).json({ acknowledged: true });

    const work = deregistrations.map(async ({ userId: garminUserId }) => {
      const userAccount = await prisma.userAccount.findUnique({
        where: {
          provider_providerUserId: { provider: 'garmin', providerUserId: garminUserId },
        },
      });

      if (!userAccount) {
        logger.warn({ requestId, garminUserId }, '[Garmin Deregistration] Unknown Garmin userId');
        return;
      }

      await prisma.$transaction(async (tx) => {
        // Revoking overwrites the stored ciphertext as well as flagging the
        // row, so deregistration leaves no usable Garmin credential behind.
        await revokeIntegration(userAccount.userId, 'GARMIN', tx);
        await tx.oauthToken.deleteMany({
          where: { userId: userAccount.userId, provider: 'garmin' },
        });
        await tx.userAccount.delete({
          where: {
            provider_providerUserId: { provider: 'garmin', providerUserId: garminUserId },
          },
        });
      });

      // Deregistration must delete the Garmin-supplied data, not just the
      // connection. Raw per-point GPS goes; the rides stay, because they are
      // the rider's own maintenance record and erasing them would destroy the
      // service history. The privacy policy states exactly this split
      // (/privacy#garmin-connect-data).
      await deleteRideStreamsForProvider(userAccount.userId, 'garmin');

      logger.info(
        { requestId, userId: userAccount.userId },
        '[Garmin Deregistration] Removed Garmin connection and raw stream data'
      );
    });

    Promise.allSettled(work)
      .then((results) => {
        const rejected = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
        logger.info(
          {
            event: 'garmin_deregistration_batch_complete',
            requestId,
            processed: results.length - rejected.length,
            failed: rejected.length,
            total: results.length,
          },
          '[Garmin Deregistration] Batch complete'
        );
        for (const failure of rejected) {
          // A failed deregistration leaves data we were asked to delete, so
          // this needs to page someone rather than sit in log volume.
          logger.error(
            {
              event: 'garmin_deregistration_failed',
              requestId,
              error:
                failure.reason instanceof Error
                  ? failure.reason.message
                  : String(failure.reason),
            },
            '[Garmin Deregistration] Failed to process a deregistration — manual cleanup required'
          );
        }
      })
      .catch((err) => logError('Garmin Deregistration batch handler', err));
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
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const { userPermissionsChange } = req.body;

    if (!userPermissionsChange || !Array.isArray(userPermissionsChange)) {
      logger.warn({ requestId, body: req.body }, '[Garmin Permissions] Invalid payload');
      return res.status(400).json({ error: 'Invalid permissions payload' });
    }

    logger.info(
      { requestId, count: userPermissionsChange.length },
      '[Garmin Permissions] Received permission change(s)'
    );

    // ACK first, process after — see the deregistration handler for the full
    // rationale. Garmin requires the 200 within 30 seconds regardless of how
    // much work the payload implies.
    res.status(200).json({ acknowledged: true });

    const work = userPermissionsChange.map(async (change) => {
      const { userId: garminUserId, permissions } = change;

      const userAccount = await prisma.userAccount.findUnique({
        where: {
          provider_providerUserId: { provider: 'garmin', providerUserId: garminUserId },
        },
      });

      if (!userAccount) {
        logger.warn({ requestId, garminUserId }, '[Garmin Permissions] Unknown Garmin userId');
        return;
      }

      logger.info(
        { requestId, userId: userAccount.userId, permissions },
        '[Garmin Permissions] User permissions'
      );

      // ACTIVITY_EXPORT is the grant every read we make depends on. When the
      // rider revokes it we must actually stop syncing, not just note it:
      // continuing to pull after a revocation is a program violation, and this
      // handler previously only logged. Revoking the integration destroys the
      // stored credentials, so every sync path fails closed —
      // getValidGarminToken returns null and the workers skip — without tearing
      // down the UserAccount link, so the rider still sees Garmin listed and
      // can re-authorize.
      if (!permissions.includes('ACTIVITY_EXPORT')) {
        logger.warn(
          { event: 'garmin_activity_export_revoked', requestId, userId: userAccount.userId },
          '[Garmin Permissions] ACTIVITY_EXPORT revoked — disabling Garmin sync'
        );

        await prisma.$transaction(async (tx) => {
          await revokeIntegration(userAccount.userId, 'GARMIN', tx);
          await tx.oauthToken.deleteMany({
            where: { userId: userAccount.userId, provider: 'garmin' },
          });
        });
      }
    });

    Promise.allSettled(work)
      .then((results) => {
        const rejected = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
        logger.info(
          {
            event: 'garmin_permissions_batch_complete',
            requestId,
            processed: results.length - rejected.length,
            failed: rejected.length,
            total: results.length,
          },
          '[Garmin Permissions] Batch complete'
        );
        for (const failure of rejected) {
          logger.error(
            {
              event: 'garmin_permissions_failed',
              requestId,
              error:
                failure.reason instanceof Error
                  ? failure.reason.message
                  : String(failure.reason),
            },
            '[Garmin Permissions] Failed to apply a permission change — sync may still be enabled'
          );
        }
      })
      .catch((err) => logError('Garmin Permissions batch handler', err));
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
 *
 * DESIGN NOTE: Fire-and-Forget Pattern
 * We respond with 200 OK immediately (Garmin requires response within 30 seconds)
 * then enqueue jobs in a non-blocking manner. If the process crashes before
 * promises settle, some jobs may not be enqueued. This is acceptable because:
 * 1. Garmin retries failed webhook deliveries (no 200 = retry)
 * 2. Activities will be picked up on next sync or backfill
 * 3. The alternative (blocking until enqueue) risks Garmin timeout and retry storms
 *
 * MONITORING: All enqueue failures emit structured log events for alerting:
 * - garmin_ping_enqueue_failed: Failed to enqueue activity job
 * - garmin_callback_enqueue_failed: Failed to enqueue callback job
 * - garmin_ping_batch_complete / garmin_callback_batch_complete: Summary with failed count
 * Set up alerts on these events to detect elevated failure rates.
 */
type GarminActivityPing = {
  userId: string;
  userAccessToken: string;
  summaryId: string;
  uploadTimestampInSeconds: number;
  /**
   * Present when Garmin pings for the activityDetails summary type. Points at
   * `/rest/activityDetails` already scoped to the notified activities, so it is
   * the shortest route to the `samples[]` array that draws the ride map. This
   * was being dropped on the floor, which is why Garmin rides had no track: the
   * worker re-pulled the *summary* endpoint instead, and summaries carry no
   * per-point data.
   */
  callbackURL?: string;
  [key: string]: unknown;
};

type GarminActivityCallback = {
  userId: string;
  callbackURL: string;
  [key: string]: unknown;
};

type GarminPingPayload = {
  requestType?: 'ping' | 'pull';
  summaryType?: string;
  activityDetails?: GarminActivityPing[];
  activities?: GarminActivityCallback[];
};

/** What handlePushedActivity decided to do with one delivery entry. */
type PushOutcome =
  | { handled: false }
  | { handled: true; status: string; summaryId?: string; jobId?: string; reason?: string };

/**
 * Take an activity Garmin PUSHed in the request body, if that is what this is.
 *
 * PUSH is the mode this integration targets. Garmin sends the whole activity
 * and expects no answer, so there is no request to make and therefore nothing
 * that can be scored as an unprompted pull or an unanswered ping. Both summary
 * types can arrive this way, so both branches below run entries through here
 * before falling back to the notification handling.
 *
 * The payload is flattened first because an activityDetails push nests its
 * stats under `summary`, and everything downstream reads the flat shape.
 *
 * Non-cycling activities are dropped here rather than on the worker. A pushed
 * payload carries its samples, and queueing a marathon's worth of them just to
 * discard them on the other side would put megabytes through Redis for nothing.
 *
 * Returns `{ handled: false }` when the entry is a notification, so the caller
 * can fall through to the callbackURL paths unchanged.
 */
async function handlePushedActivity(
  requestId: string,
  internalUserId: string,
  rawEntry: GarminDeliveryEntry
): Promise<PushOutcome> {
  const entry = flattenGarminActivity(rawEntry);
  if (!isPushedGarminActivity(entry)) return { handled: false };

  const summaryId = typeof entry.summaryId === 'string' ? entry.summaryId : undefined;
  if (!summaryId) {
    // The job id is built from the activity id, so without one two deliveries
    // of the same ride would queue twice and race each other's upsert.
    logger.warn(
      { requestId, activityType: entry.activityType },
      '[Garmin PUSH] Pushed activity has no summaryId, skipping'
    );
    return { handled: true, status: 'skipped', reason: 'no_summary_id' };
  }

  if (!isGarminCyclingActivity(entry.activityType)) {
    logger.debug(
      { requestId, summaryId, activityType: entry.activityType },
      '[Garmin PUSH] Skipping non-cycling pushed activity'
    );
    return { handled: true, status: 'skipped', summaryId, reason: 'not_cycling' };
  }

  const result = await enqueueSyncJob('syncActivity', {
    userId: internalUserId,
    provider: 'garmin',
    activityId: summaryId,
    pushedActivity: entry,
  });

  logger.info(
    {
      event: 'garmin_push_job_enqueued',
      requestId,
      jobId: result.jobId,
      summaryId,
      userId: internalUserId,
      hasSamples: Array.isArray(entry.samples) && entry.samples.length > 0,
      status: result.status,
    },
    '[Garmin PUSH] Enqueued sync job from pushed activity'
  );

  return { handled: true, status: result.status, summaryId, jobId: result.jobId };
}

r.post<Empty, void, GarminPingPayload>(
  '/webhooks/garmin/activities-ping',
  async (req: Request, res: Response) => {
    // Generate correlation ID for audit trail
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

    // Log incoming webhook request IMMEDIATELY to verify Garmin is hitting this endpoint
    logger.debug({ requestId, headers: req.headers, body: req.body }, '[Garmin PING Webhook] Incoming request');

    try {
      const { requestType, summaryType, activityDetails, activities } = req.body;

      // Handle explicit ping requests - acknowledge immediately with no side effects
      if (requestType === 'ping') {
        logger.info({
          event: 'garmin_ping_acknowledged',
          requestId,
          summaryType,
        }, '[Garmin PING] Acknowledged ping request');

        return res.status(200).json({ acknowledged: true });
      }

      // Handle pull requests - validation probes from Garmin
      if (requestType === 'pull') {
        logger.info({
          event: 'garmin_pull_acknowledged',
          requestId,
          summaryType,
        }, '[Garmin PULL] Acknowledged pull request (validation probe)');

        // Return valid schema even for empty/zero-width time windows
        return res.status(200).json({
          activities: [],
          acknowledged: true,
        });
      }

      // Handle the "activities" format with callbackURL (used for backfill)
      if (activities && Array.isArray(activities) && activities.length > 0) {
        logger.info({
          event: 'garmin_callback_received',
          requestId,
          count: activities.length,
        }, '[Garmin PING] Received callback notification(s)');

        // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
        res.status(200).json({ acknowledged: true });

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

          // Active-source policy (shared with Strava/WHOOP/Suunto webhooks):
          // when a user has multiple providers connected, only the
          // `activeDataSource` one writes rides. Prevents duplicate imports
          // when e.g. a Suunto watch also auto-syncs to Garmin. Users
          // configure this via the DataSourceSelector in Settings, which
          // explains the behavior. No-active-source → every provider passes.
          if (!await isActiveSource(userAccount.userId, 'garmin')) {
            logger.info(
              { requestId, garminUserId },
              '[Garmin PING] User active source is not Garmin, skipping callback'
            );
            return { status: 'skipped', reason: 'inactive_source' };
          }

          // PUSH first: the activities summary type can also be delivered as
          // data rather than as a callbackURL pointer.
          const pushed = await handlePushedActivity(requestId, userAccount.userId, notification);
          if (pushed.handled) return pushed;

          // Everything past here is a notification, which means a callbackURL
          // to follow. Without one there is nothing to fetch and nothing was
          // pushed, so the delivery is unusable; enqueueing anyway produced a
          // callback job with no URL that the worker rejected as a malformed
          // backfill.
          if (!callbackURL) {
            logger.warn(
              { requestId, garminUserId },
              '[Garmin PING] Activities delivery had neither a pushed payload nor a callbackURL'
            );
            return { status: 'skipped', reason: 'no_payload_or_callback' };
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

        // Non-blocking - don't await, but log completion and failures
        Promise.allSettled(enqueuePromises).then((results) => {
          const fulfilled = results.filter(r => r.status === 'fulfilled');
          const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

          logger.info({
            event: 'garmin_callback_batch_complete',
            requestId,
            queued: fulfilled.length,
            failed: rejected.length,
            total: results.length,
          }, '[Garmin PING] Callback batch enqueue complete');

          // Log each failure for alerting/monitoring
          for (const failure of rejected) {
            logger.error({
              event: 'garmin_callback_enqueue_failed',
              requestId,
              error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
            }, '[Garmin PING] Failed to enqueue callback job - activity may need manual recovery');
          }
        }).catch((err) => {
          // Catch any errors in the .then() handler itself
          logger.error({
            event: 'garmin_callback_batch_handler_error',
            requestId,
            error: err instanceof Error ? err.message : String(err),
          }, '[Garmin PING] Error in callback batch completion handler');
        });

        return;
      }

      // Handle the "activityDetails" format with summaryId (PING mode)
      if (activityDetails && Array.isArray(activityDetails) && activityDetails.length > 0) {
        logger.info({
          event: 'garmin_activity_notification',
          requestId,
          requestType: requestType || 'upload',
          summaryType,
          notificationCount: activityDetails.length,
          summaryIds: activityDetails.map(n => n.summaryId),
        }, '[Garmin] Received activity notification(s)');

        // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
        res.status(200).json({ acknowledged: true });

        // Fire-and-forget: Enqueue jobs for background processing
        const enqueuePromises = activityDetails.map(async (notification) => {
          const { userId: garminUserId, summaryId, callbackURL } = notification;

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

          // Active-source policy (see callback branch above for the full
          // explanation — same gate applied to PING-mode activity deliveries).
          if (!await isActiveSource(userAccount.userId, 'garmin')) {
            logger.info(
              { requestId, garminUserId, summaryId },
              '[Garmin PING] User active source is not Garmin, skipping'
            );
            return { status: 'skipped', summaryId, reason: 'inactive_source' };
          }

          // PUSH first: if Garmin sent the activity itself there is nothing to
          // fetch, and no request means nothing verification can score.
          const pushed = await handlePushedActivity(requestId, userAccount.userId, notification);
          if (pushed.handled) return pushed;

          // A backfill of activityDetails answers on this same key, but with a
          // callbackURL and no summaryId. There is no single activity to name
          // because the URL covers a whole window. Route those to the callback
          // processor, which fetches the batch and upserts each entry. Without
          // this they would enqueue a syncActivity job with no activityId,
          // which the worker rejects outright.
          if (!summaryId && callbackURL) {
            const callbackResult = await enqueueCallbackJob({
              userId: userAccount.userId,
              provider: 'garmin',
              callbackURL,
            });
            logger.info({
              event: 'garmin_details_callback_enqueued',
              requestId,
              jobId: callbackResult.jobId,
              userId: userAccount.userId,
              status: callbackResult.status,
            }, '[Garmin PING] Enqueued activityDetails callback job');
            return { status: callbackResult.status, jobId: callbackResult.jobId };
          }

          // Enqueue sync job with deterministic ID for deduplication.
          // The callbackURL rides along because following it is what makes the
          // worker's request a prompted pull and marks this ping answered. It
          // is not part of the job id, so dedup still keys on the activity.
          const result = await enqueueSyncJob('syncActivity', {
            userId: userAccount.userId,
            provider: 'garmin',
            activityId: summaryId,
            callbackURL,
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

        // Non-blocking - don't await, but log completion and failures
        Promise.allSettled(enqueuePromises).then((results) => {
          const fulfilled = results.filter(r => r.status === 'fulfilled');
          const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

          logger.info({
            event: 'garmin_ping_batch_complete',
            requestId,
            queued: fulfilled.length,
            failed: rejected.length,
            total: results.length,
          }, '[Garmin PING] Activity batch enqueue complete');

          // Log each failure for alerting/monitoring
          for (const failure of rejected) {
            logger.error({
              event: 'garmin_ping_enqueue_failed',
              requestId,
              error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
            }, '[Garmin PING] Failed to enqueue activity job - activity may need manual recovery');
          }
        }).catch((err) => {
          // Catch any errors in the .then() handler itself
          logger.error({
            event: 'garmin_ping_batch_handler_error',
            requestId,
            error: err instanceof Error ? err.message : String(err),
          }, '[Garmin PING] Error in activity batch completion handler');
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
      // Error occurred after 200 OK was sent - log explicitly for visibility
      logger.error({
        event: 'garmin_ping_post_response_error',
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }, '[Garmin PING] Error after response sent (200 OK already returned to Garmin)');
    }
  }
);

export default r;
