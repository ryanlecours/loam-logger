import { Router as createRouter, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { enqueueSyncJob } from '../lib/queue/sync.queue';
import { logger } from '../lib/logger';
import { isActiveSource } from '../lib/active-source';
import {
  findAdjustedComponentIdsForRides,
  recomputeAdjustedComponentsForRides,
  syncBikeComponentHours,
} from '../lib/component-hours';
import { invalidateBikePrediction } from '../services/prediction/cache';

const r = createRouter();

/**
 * WHOOP Webhook Handler
 *
 * Receives workout events from WHOOP:
 * - workout.created: New workout recorded
 * - workout.updated: Existing workout modified
 * - workout.deleted: Workout removed
 *
 * WHOOP webhook payload structure (v2):
 * {
 *   "user_id": 123456,
 *   "id": "uuid-workout-id",
 *   "event_type": "workout.created" | "workout.updated" | "workout.deleted",
 *   "timestamp": "2024-01-15T10:00:00Z"
 * }
 */

interface WhoopWebhookPayload {
  user_id: number;
  id: string; // v2 UUID workout ID
  event_type: 'workout.created' | 'workout.updated' | 'workout.deleted';
  timestamp: string;
}

/**
 * Webhook verification endpoint (GET)
 * WHOOP may require challenge-response verification when registering webhooks
 */
r.get('/whoop', (req: Request, res: Response) => {
  const challenge = req.query.challenge as string | undefined;

  if (challenge) {
    logger.info('[WHOOP Webhook] Verification challenge received');
    // Echo challenge for WHOOP verification
    return res.status(200).send(challenge);
  }

  return res.status(400).send('Missing challenge parameter');
});

/**
 * Webhook event handler (POST)
 * Receives and processes WHOOP workout events
 */
r.post('/whoop', async (req: Request, res: Response) => {
  // Respond immediately (WHOOP expects <30s response)
  res.status(200).send('OK');

  try {
    const payload = req.body as WhoopWebhookPayload;
    const { user_id, id: workoutId, event_type, timestamp } = payload;

    logger.info(
      { whoopUserId: user_id, workoutId, event_type, timestamp },
      '[WHOOP Webhook] Received event'
    );

    // Validate payload
    if (!user_id || !workoutId || !event_type) {
      logger.warn({ payload }, '[WHOOP Webhook] Invalid payload - missing required fields');
      return;
    }

    // Lookup our user by WHOOP user ID
    const user = await prisma.user.findUnique({
      where: { whoopUserId: user_id.toString() },
      select: { id: true },
    });

    if (!user) {
      logger.warn({ whoopUserId: user_id }, '[WHOOP Webhook] Unknown WHOOP user');
      return;
    }

    // Active-source policy (shared with Strava/Garmin/Suunto webhooks): when
    // a user has multiple providers connected, only the `activeDataSource`
    // one writes rides. Prevents duplicate imports when e.g. a Suunto watch
    // also auto-syncs to WHOOP. Users configure this via the DataSourceSelector
    // in Settings, which explains the behavior. No-active-source → every
    // provider passes.
    if (!await isActiveSource(user.id, 'whoop')) {
      logger.info(
        { whoopUserId: user_id },
        '[WHOOP Webhook] User active source is not WHOOP, skipping'
      );
      return;
    }

    // Handle different event types
    switch (event_type) {
      case 'workout.deleted': {
        // Delete the ride(s) and keep component hours + ride adjustments in
        // sync — mirrors the Strava delete webhook. Without this, a deleted
        // WHOOP workout leaves its hours credited to the bike's components
        // and orphans any cross-bike INCLUDE adjustment that referenced it.
        const affectedBikeIds = await prisma.$transaction(async (tx) => {
          const rides = await tx.ride.findMany({
            where: { userId: user.id, whoopWorkoutId: workoutId },
            select: { id: true, bikeId: true, durationSeconds: true },
          });

          if (rides.length === 0) {
            logger.debug(
              { workoutId, userId: user.id },
              '[WHOOP Webhook] Workout not found (may not have been imported)'
            );
            return [] as string[];
          }

          // Capture BEFORE the delete — adjustment rows cascade away with the
          // ride, and cross-bike INCLUDEs live on components the per-ride
          // decrement below never touches.
          const adjustedComponentIds = await findAdjustedComponentIdsForRides(
            tx,
            rides.map((ride) => ride.id)
          );

          const bikeIds = new Set<string>();
          for (const ride of rides) {
            if (ride.bikeId) bikeIds.add(ride.bikeId);
            await syncBikeComponentHours(
              tx,
              user.id,
              { bikeId: ride.bikeId ?? null, durationSeconds: ride.durationSeconds },
              { bikeId: null, durationSeconds: 0 }
            );
          }

          await tx.ride.deleteMany({
            where: { id: { in: rides.map((ride) => ride.id) } },
          });

          const adjustedBikeIds = await recomputeAdjustedComponentsForRides(tx, {
            componentIds: adjustedComponentIds,
          });
          for (const bikeId of adjustedBikeIds) bikeIds.add(bikeId);

          logger.info(
            { workoutId, userId: user.id, count: rides.length },
            '[WHOOP Webhook] Marked workout as deleted'
          );

          return [...bikeIds];
        });

        // Invalidate prediction caches for every bike whose component hours
        // changed (the bulk decrement and any adjusted-component recompute) —
        // independent cache busts, so fire them together. Best-effort: the
        // delete already committed, so catch a bust failure here rather than
        // letting it bubble to the outer catch and log a misleading
        // "Processing failed" (a stale prediction self-heals at the cache TTL).
        try {
          await Promise.all(
            affectedBikeIds.map((bikeId) => invalidateBikePrediction(user.id, bikeId))
          );
        } catch (err) {
          logger.error(
            { err, workoutId, userId: user.id },
            '[WHOOP Webhook] Cache invalidation failed after workout.deleted'
          );
        }
        break;
      }

      case 'workout.created':
      case 'workout.updated': {
        // Enqueue sync job to fetch and upsert the workout
        await enqueueSyncJob('syncActivity', {
          userId: user.id,
          provider: 'whoop',
          activityId: workoutId,
        });

        logger.info(
          { workoutId, userId: user.id, event_type },
          '[WHOOP Webhook] Enqueued sync job'
        );
        break;
      }

      default:
        logger.warn({ event_type }, '[WHOOP Webhook] Unknown event type');
    }
  } catch (error) {
    // Log error but don't throw - we already sent 200 OK
    logger.error({ error }, '[WHOOP Webhook] Processing failed');
  }
});

export default r;
