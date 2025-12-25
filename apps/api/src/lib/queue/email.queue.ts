import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

export type EmailJobName =
  | 'activation'
  | 'welcome-1'
  | 'welcome-2'
  | 'welcome-3';

export type EmailJobData = {
  userId: string;
  email: string;
  name?: string;
  tempPassword?: string; // Only for activation emails
};

let emailQueue: Queue<EmailJobData, void, EmailJobName> | null = null;

/**
 * Get or create the email queue singleton.
 */
export function getEmailQueue(): Queue<EmailJobData, void, EmailJobName> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData, void, EmailJobName>('email', {
      ...getQueueConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return emailQueue;
}

/**
 * Schedule the welcome email series for a newly activated user.
 * Emails are sent at: Day 1, Day 3, Day 7
 */
export async function scheduleWelcomeSeries(
  userId: string,
  email: string,
  name?: string
): Promise<void> {
  const queue = getEmailQueue();
  const baseData = { userId, email, name };

  // Welcome email 1: 1 day after activation
  await queue.add('welcome-1', baseData, {
    delay: 24 * 60 * 60 * 1000, // 24 hours
    jobId: `welcome-1-${userId}`,
  });

  // Welcome email 2: 3 days after activation
  await queue.add('welcome-2', baseData, {
    delay: 3 * 24 * 60 * 60 * 1000, // 72 hours
    jobId: `welcome-2-${userId}`,
  });

  // Welcome email 3: 7 days after activation
  await queue.add('welcome-3', baseData, {
    delay: 7 * 24 * 60 * 60 * 1000, // 168 hours
    jobId: `welcome-3-${userId}`,
  });

  console.log(`[EmailQueue] Scheduled welcome series for ${email}`);
}

/**
 * Close the email queue connection.
 */
export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}
