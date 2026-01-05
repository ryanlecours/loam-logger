import { Queue } from 'bullmq';
import { getQueueConnection } from './connection';

// Time constants in milliseconds
const SECONDS = 1000;
const HOURS = 60 * 60 * SECONDS;
const DAYS = 24 * HOURS;

// Job retry configuration
const INITIAL_RETRY_DELAY_MS = 1 * SECONDS;
const MAX_RETRY_ATTEMPTS = 3;
const COMPLETED_JOBS_TO_KEEP = 10;
const FAILED_JOBS_TO_KEEP = 50;

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
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: INITIAL_RETRY_DELAY_MS,
        },
        removeOnComplete: COMPLETED_JOBS_TO_KEEP,
        removeOnFail: FAILED_JOBS_TO_KEEP,
      },
    });
  }
  return emailQueue;
}

/**
 * Add a job to the email queue, silently ignoring duplicates.
 * BullMQ throws an error when a job with the same ID already exists.
 * This wrapper catches that error and logs it as a warning instead.
 *
 * @returns true if job was added, false if duplicate was ignored
 */
export async function addEmailJob(
  name: EmailJobName,
  data: EmailJobData,
  options: { delay?: number; jobId: string }
): Promise<boolean> {
  const queue = getEmailQueue();
  try {
    await queue.add(name, data, options);
    return true;
  } catch (err) {
    // BullMQ throws "Job with id X already exists" for duplicates
    if (err instanceof Error && err.message.includes('already exists')) {
      console.warn(`[EmailQueue] Duplicate job ignored: ${options.jobId}`);
      return false;
    }
    throw err;
  }
}

/**
 * Schedule the welcome email series for a newly activated user.
 * Emails are sent at: Day 1, Day 3, Day 7
 * Duplicate jobs are silently ignored.
 */
export async function scheduleWelcomeSeries(
  userId: string,
  email: string,
  name?: string
): Promise<void> {
  const baseData = { userId, email, name };

  await addEmailJob('welcome-1', baseData, {
    delay: WELCOME_EMAIL_DELAYS.WELCOME_1,
    jobId: `welcome-1-${userId}`,
  });

  await addEmailJob('welcome-2', baseData, {
    delay: WELCOME_EMAIL_DELAYS.WELCOME_2,
    jobId: `welcome-2-${userId}`,
  });

  await addEmailJob('welcome-3', baseData, {
    delay: WELCOME_EMAIL_DELAYS.WELCOME_3,
    jobId: `welcome-3-${userId}`,
  });

  console.log(`[EmailQueue] Scheduled welcome series for ${email}`);
}

/**
 * Cancel any pending welcome emails for a user (called when they unsubscribe).
 * Uses deterministic job IDs to find and remove jobs.
 */
export async function cancelPendingWelcomeEmails(userId: string): Promise<void> {
  const queue = getEmailQueue();
  const jobIds = [
    `welcome-1-${userId}`,
    `welcome-2-${userId}`,
    `welcome-3-${userId}`,
  ];

  for (const jobId of jobIds) {
    try {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`[EmailQueue] Cancelled pending job: ${jobId}`);
      }
    } catch (err) {
      // Job may not exist or already completed - that's fine
      console.warn(`[EmailQueue] Could not cancel job ${jobId}:`, err);
    }
  }
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
