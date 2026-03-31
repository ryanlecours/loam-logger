import { Worker, Job } from 'bullmq';
import { Expo, type ExpoPushReceipt } from 'expo-server-sdk';
import { getQueueConnection } from '../lib/queue/connection';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { NotificationJobData, NotificationJobName } from '../lib/queue/notification.queue';

const expo = new Expo();

/**
 * Process a receipt check job: poll Expo for delivery receipts and handle errors.
 *
 * The key error we act on is DeviceNotRegistered — this means the user uninstalled
 * the app or revoked notification permissions, so we clear their stored push token
 * to stop attempting future sends.
 */
async function processReceiptCheck(job: Job<NotificationJobData, void, NotificationJobName>): Promise<void> {
  const { userId, ticketIds } = job.data;

  logger.debug({ userId, ticketCount: ticketIds.length }, '[NotificationWorker] Checking receipts');

  const receiptChunks = expo.chunkPushNotificationReceiptIds(ticketIds);

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

      // DeviceNotRegistered means the token is permanently invalid — clear it
      if (receipt.details?.error === 'DeviceNotRegistered') {
        logger.info({ userId }, '[NotificationWorker] Clearing invalid push token (DeviceNotRegistered)');
        await prisma.user.update({
          where: { id: userId },
          data: { expoPushToken: null },
        });
        return; // Token cleared — no point checking remaining receipts for this user
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
    logger.warn({ jobId: job?.id, error: err.message }, '[NotificationWorker] Receipt check failed');
  });

  notificationWorker.on('error', (err) => {
    logger.error({ error: err.message }, '[NotificationWorker] Worker error');
  });

  return notificationWorker;
}

export async function closeNotificationWorker(): Promise<void> {
  if (notificationWorker) {
    await notificationWorker.close();
    notificationWorker = null;
  }
}
