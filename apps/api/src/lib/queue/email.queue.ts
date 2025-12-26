import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

// Time constants in milliseconds
const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

/**
 * Welcome email series delays after activation.
 * These can be adjusted to tune the onboarding experience.
 */
export const WELCOME_EMAIL_DELAYS = {
  /** Day 1: Getting started tips */
  WELCOME_1: 1 * DAYS,
  /** Day 3: Feature highlights */
  WELCOME_2: 3 * DAYS,
  /** Day 7: Integration prompts */
  WELCOME_3: 7 * DAYS,
} as const;

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

  await queue.add('welcome-1', baseData, {
    delay: WELCOME_EMAIL_DELAYS.WELCOME_1,
    jobId: `welcome-1-${userId}`,
  });

  await queue.add('welcome-2', baseData, {
    delay: WELCOME_EMAIL_DELAYS.WELCOME_2,
    jobId: `welcome-2-${userId}`,
  });

  await queue.add('welcome-3', baseData, {
    delay: WELCOME_EMAIL_DELAYS.WELCOME_3,
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
