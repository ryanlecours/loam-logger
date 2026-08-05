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
  /**
   * The push token these tickets were sent to. Lets the receipt worker
   * compare-and-clear on DeviceNotRegistered instead of blindly nulling
   * User.expoPushToken, which is one column per user rather than per
   * device: a dead token's receipt arriving after another device has
   * claimed the slot would otherwise wipe that live device's token.
   *
   * Optional only for jobs enqueued before this field existed. Those are
   * drained within the 15-minute receipt delay of a deploy, and the worker
   * skips the clear rather than falling back to the unsafe blind write.
   */
  pushToken?: string;
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
export async function enqueueReceiptCheck(
  userId: string,
  ticketIds: string[],
  pushToken?: string
): Promise<void> {
  if (ticketIds.length === 0) return;

  const queue = getNotificationQueue();

  try {
    await queue.add('checkReceipts', { userId, ticketIds, pushToken }, { delay: RECEIPT_CHECK_DELAY_MS });
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
