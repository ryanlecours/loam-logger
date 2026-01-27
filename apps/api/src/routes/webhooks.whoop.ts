import { Router as createRouter, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { enqueueSyncJob } from '../lib/queue/sync.queue';
import { logger } from '../lib/logger';

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

    // Handle different event types
    switch (event_type) {
      case 'workout.deleted': {
        // Soft delete the ride (mark as deleted rather than hard delete)
        const updateResult = await prisma.ride.updateMany({
          where: { userId: user.id, whoopWorkoutId: workoutId },
          data: { deletedAt: new Date() },
        });

        if (updateResult.count > 0) {
          logger.info(
            { workoutId, userId: user.id },
            '[WHOOP Webhook] Marked workout as deleted'
          );
        } else {
          logger.debug(
            { workoutId, userId: user.id },
            '[WHOOP Webhook] Workout not found (may not have been imported)'
          );
        }
        break;
      }

      case 'workout.created':
      case 'workout.updated': {
        // Enqueue sync job to fetch and upsert the workout
        await enqueueSyncJob({
          name: 'syncActivity',
          data: {
            userId: user.id,
            provider: 'whoop',
            activityId: workoutId,
          },
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
