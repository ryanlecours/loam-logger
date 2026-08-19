import '../instrument'; // Ensure Sentry is initialized even if worker runs in a separate process
import { Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { reportWorkerFailure } from './report-failure';
import type { ExpoPushReceipt } from 'expo-server-sdk';
import { expo } from '../lib/expo';
import { getQueueConnection } from '../lib/queue/connection';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { NotificationJobData, NotificationJobName } from '../lib/queue/notification.queue';

/**
 * Process a receipt check job: poll Expo for delivery receipts and handle errors.
 *
 * The key error we act on is DeviceNotRegistered — this means the user uninstalled
 * the app or revoked notification permissions, so we clear their stored push token
 * to stop attempting future sends.
 */
export async function processReceiptCheck(job: Job<NotificationJobData, void, NotificationJobName>): Promise<void> {
  const { userId, ticketIds, pushToken } = job.data;

  logger.debug({ userId, ticketCount: ticketIds.length }, '[NotificationWorker] Checking receipts');

  const receiptChunks = expo.chunkPushNotificationReceiptIds(ticketIds);

  let tokenCleared = false;

  for (const chunk of receiptChunks) {
    let receipts: { [id: string]: ExpoPushReceipt };

    try {
      receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    } catch (err) {
      logger.warn({ userId, error: err }, '[NotificationWorker] Failed to fetch receipts from Expo');
      throw err; // Let BullMQ retry
    }

    for (const [receiptId, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'ok') continue;

      logger.warn(
        { userId, receiptId, message: receipt.message, details: receipt.details },
        '[NotificationWorker] Push delivery failed'
      );

      // DeviceNotRegistered means this token is permanently invalid: the
      // app was uninstalled or notification permission was revoked.
      if (receipt.details?.error === 'DeviceNotRegistered') {
        if (!tokenCleared) {
          // Compare-and-clear, never a blind null. User.expoPushToken is one
          // column per user rather than per device, so two devices on one
          // account share a single slot and the last to register wins it.
          // These receipts are ~15 minutes stale by design, which is ample
          // time for another device to have claimed the slot; nulling
          // unconditionally would silently kill push on that live device
          // because a DIFFERENT, now-dead device's receipt came back.
          // Matching on the token these tickets were actually sent to means
          // we can only ever clear the dead one.
          if (!pushToken) {
            // Job predates pushToken being on the payload. Skip rather than
            // fall back to the unsafe blind write: the cost is one dead
            // token surviving until the next send fails, whose receipt job
            // will carry the token and clear it properly.
            logger.warn(
              { userId },
              '[NotificationWorker] DeviceNotRegistered on a legacy job with no pushToken; skipping clear'
            );
          } else {
            const result = await prisma.user.updateMany({
              where: { id: userId, expoPushToken: pushToken },
              data: { expoPushToken: null },
            });
            logger.info(
              { userId, cleared: result.count > 0 },
              '[NotificationWorker] DeviceNotRegistered; cleared push token if still current'
            );
          }
          tokenCleared = true;
        }
      }
    }
  }
}

let notificationWorker: Worker<NotificationJobData, void, NotificationJobName> | null = null;

export function createNotificationWorker(): Worker<NotificationJobData, void, NotificationJobName> {
  if (notificationWorker) return notificationWorker;

  notificationWorker = new Worker<NotificationJobData, void, NotificationJobName>(
    'notification',
    processReceiptCheck,
    {
      connection: getQueueConnection(),
      concurrency: 3,
      drainDelay: 5000,
    }
  );

  notificationWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, '[NotificationWorker] Receipt check completed');
  });

  notificationWorker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, error: err.message }, '[NotificationWorker] Job failed');
    reportWorkerFailure('notification', job, err);
  });

  notificationWorker.on('error', (err) => {
    logger.error({ error: err.message }, '[NotificationWorker] Worker error');
    Sentry.captureException(err, { tags: { worker: 'notification' } });
  });

  return notificationWorker;
}

export async function closeNotificationWorker(): Promise<void> {
  if (notificationWorker) {
    await notificationWorker.close();
    notificationWorker = null;
  }
}
