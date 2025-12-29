import { Worker, Job } from 'bullmq';
import { getQueueConnection } from '../lib/queue/connection';
import { sendEmail } from '../services/email.service';
import {
  getActivationEmailHtml,
  getActivationEmailSubject,
  getWelcome1Html,
  getWelcome1Subject,
  getWelcome2Html,
  getWelcome2Subject,
  getWelcome3Html,
  getWelcome3Subject,
} from '../templates/emails';
import type { EmailJobData, EmailJobName } from '../lib/queue/email.queue';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Email validation regex (RFC 5322 simplified)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Max lengths to prevent abuse
const MAX_EMAIL_LENGTH = 254; // RFC 5321
const MAX_NAME_LENGTH = 100;

/**
 * Validate and sanitize email job data.
 * Throws descriptive errors for invalid data.
 */
function validateJobData(
  jobName: EmailJobName,
  data: EmailJobData
): { email: string; name: string | undefined; userId: string } {
  const { email, name, userId, tempPassword } = data;

  // Validate userId
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('Invalid job data: userId is required');
  }

  // Validate email - required for all email jobs
  if (!email || typeof email !== 'string') {
    throw new Error('Invalid job data: email is required');
  }

  const trimmedEmail = email.trim().toLowerCase();

  if (trimmedEmail.length === 0) {
    throw new Error('Invalid job data: email cannot be empty');
  }

  if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
    throw new Error(`Invalid job data: email exceeds ${MAX_EMAIL_LENGTH} characters`);
  }

  if (!EMAIL_REGEX.test(trimmedEmail)) {
    throw new Error('Invalid job data: email format is invalid');
  }

  // Validate name - optional but must be valid if provided
  let sanitizedName: string | undefined;
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string') {
      throw new Error('Invalid job data: name must be a string');
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 0) {
      if (trimmedName.length > MAX_NAME_LENGTH) {
        throw new Error(`Invalid job data: name exceeds ${MAX_NAME_LENGTH} characters`);
      }
      sanitizedName = trimmedName;
    }
  }

  // Validate tempPassword for activation emails
  if (jobName === 'activation') {
    if (!tempPassword || typeof tempPassword !== 'string' || tempPassword.length === 0) {
      throw new Error('Invalid job data: activation email requires tempPassword');
    }
  }

  return {
    email: trimmedEmail,
    name: sanitizedName,
    userId: userId.trim(),
  };
}

async function processEmailJob(job: Job<EmailJobData, void, EmailJobName>): Promise<void> {
  // Validate all job data upfront
  const { email, name } = validateJobData(job.name, job.data);
  const { tempPassword } = job.data;

  console.log(`[EmailWorker] Processing ${job.name} for ${email}`);

  switch (job.name) {
    case 'activation':
      // tempPassword already validated in validateJobData
      await sendEmail({
        to: email,
        subject: getActivationEmailSubject(),
        html: getActivationEmailHtml({
          name,
          email,
          tempPassword: tempPassword!,
          loginUrl: `${FRONTEND_URL}/login`,
        }),
      });
      break;

    case 'welcome-1':
      await sendEmail({
        to: email,
        subject: getWelcome1Subject(),
        html: getWelcome1Html({
          name,
          dashboardUrl: `${FRONTEND_URL}/dashboard`,
        }),
      });
      break;

    case 'welcome-2':
      await sendEmail({
        to: email,
        subject: getWelcome2Subject(),
        html: getWelcome2Html({
          name,
          gearUrl: `${FRONTEND_URL}/gear`,
        }),
      });
      break;

    case 'welcome-3':
      await sendEmail({
        to: email,
        subject: getWelcome3Subject(),
        html: getWelcome3Html({
          name,
          settingsUrl: `${FRONTEND_URL}/settings`,
        }),
      });
      break;

    default:
      throw new Error(`Unknown email job type: ${job.name}`);
  }
}

let emailWorker: Worker<EmailJobData, void, EmailJobName> | null = null;

/**
 * Create and start the email worker.
 */
export function createEmailWorker(): Worker<EmailJobData, void, EmailJobName> {
  if (emailWorker) {
    return emailWorker;
  }

  emailWorker = new Worker<EmailJobData, void, EmailJobName>(
    'email',
    processEmailJob,
    {
      connection: getQueueConnection(),
      concurrency: 5,
    }
  );

  emailWorker.on('completed', (job) => {
    console.log(`[EmailWorker] Job ${job.id} (${job.name}) completed`);
  });

  emailWorker.on('failed', (job, err) => {
    console.error(`[EmailWorker] Job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  emailWorker.on('error', (err) => {
    console.error('[EmailWorker] Worker error:', err.message);
  });

  console.log('[EmailWorker] Started');
  return emailWorker;
}

/**
 * Stop and close the email worker.
 */
export async function closeEmailWorker(): Promise<void> {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
    console.log('[EmailWorker] Stopped');
  }
}
