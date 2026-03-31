import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';
import { logger } from '../logger';

const SECONDS = 1000;
const MINUTES = 60 * SECONDS;

// Expo recommends waiting at least 15 minutes before polling receipts
const RECEIPT_CHECK_DELAY_MS = 15 * MINUTES;

const MAX_RETRY_ATTEMPTS = 3;
const COMPLETED_JOBS_TO_KEEP = 50;
const FAILED_JOBS_TO_KEEP = 100;
const LOW_PRIORITY = 10;

export type NotificationJobName = 'checkReceipts';

export type NotificationJobData = {
  userId: string;
  ticketIds: string[];
};

let notificationQueue: Queue<NotificationJobData, void, NotificationJobName> | null = null;

export function getNotificationQueue(): Queue<NotificationJobData, void, NotificationJobName> {
  if (!notificationQueue) {
    notificationQueue = new Queue<NotificationJobData, void, NotificationJobName>('notification', {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: 1 * MINUTES,
        },
        priority: LOW_PRIORITY,
        removeOnComplete: COMPLETED_JOBS_TO_KEEP,
        removeOnFail: FAILED_JOBS_TO_KEEP,
      },
    });
  }
  return notificationQueue;
}

/**
 * Enqueue a delayed job to check Expo push notification receipts.
 * Expo recommends waiting ~15 minutes before polling for receipts.
 */
export async function enqueueReceiptCheck(userId: string, ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;

  const queue = getNotificationQueue();

  try {
    await queue.add('checkReceipts', { userId, ticketIds }, { delay: RECEIPT_CHECK_DELAY_MS });
    logger.debug({ userId, ticketCount: ticketIds.length }, '[NotificationQueue] Enqueued receipt check');
  } catch (err) {
    logger.warn({ userId, error: err }, '[NotificationQueue] Failed to enqueue receipt check (non-fatal)');
  }
}

export async function closeNotificationQueue(): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.close();
    notificationQueue = null;
  }
}
