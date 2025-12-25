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

async function processEmailJob(job: Job<EmailJobData, void, EmailJobName>): Promise<void> {
  const { email, name, tempPassword } = job.data;

  console.log(`[EmailWorker] Processing ${job.name} for ${email}`);

  switch (job.name) {
    case 'activation':
      if (!tempPassword) {
        throw new Error('Activation email requires tempPassword');
      }
      await sendEmail({
        to: email,
        subject: getActivationEmailSubject(),
        html: getActivationEmailHtml({
          name,
          email,
          tempPassword,
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
      ...getQueueConnection(),
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
