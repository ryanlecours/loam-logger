import { prisma } from '../lib/prisma';
import { sendEmailWithAudit } from './email.service';
import { getAnnouncementEmailHtml, ANNOUNCEMENT_TEMPLATE_VERSION } from '../templates/emails';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';

const API_URL = process.env.API_URL || 'http://localhost:4000';

// Check for due emails every minute
const CHECK_INTERVAL_MS = 60 * 1000;

let schedulerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Process a single scheduled email.
 * Sends emails to all recipients and updates the record with results.
 */
async function processScheduledEmail(scheduledEmailId: string): Promise<void> {
  console.log(`[EmailScheduler] Processing scheduled email ${scheduledEmailId}`);

  // Load the scheduled email record
  const scheduledEmail = await prisma.scheduledEmail.findUnique({
    where: { id: scheduledEmailId },
  });

  if (!scheduledEmail) {
    console.error(`[EmailScheduler] Scheduled email ${scheduledEmailId} not found`);
    return;
  }

  // Double-check it's still pending (might have been cancelled)
  if (scheduledEmail.status !== 'pending') {
    console.log(`[EmailScheduler] Scheduled email ${scheduledEmailId} is ${scheduledEmail.status}, skipping`);
    return;
  }

  // Update status to processing
  await prisma.scheduledEmail.update({
    where: { id: scheduledEmailId },
    data: { status: 'processing' },
  });

  // Load all recipients
  const recipients = await prisma.user.findMany({
    where: { id: { in: scheduledEmail.recipientIds } },
    select: {
      id: true,
      email: true,
      name: true,
      emailUnsubscribed: true,
    },
  });

  if (recipients.length === 0) {
    console.error(`[EmailScheduler] No recipients found for scheduled email ${scheduledEmailId}`);
    await prisma.scheduledEmail.update({
      where: { id: scheduledEmailId },
      data: {
        status: 'failed',
        errorMessage: 'No valid recipients found',
        processedAt: new Date(),
      },
    });
    return;
  }

  const results = {
    sent: 0,
    failed: 0,
    suppressed: 0,
  };

  const emailType = scheduledEmail.templateType === 'announcement' ? 'announcement' : 'custom';

  // Send emails sequentially to respect provider rate limits
  for (const recipient of recipients) {
    try {
      const unsubscribeToken = generateUnsubscribeToken(recipient.id);
      const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

      const html = getAnnouncementEmailHtml({
        name: recipient.name || undefined,
        subject: scheduledEmail.subject,
        messageHtml: scheduledEmail.messageHtml,
        unsubscribeUrl,
      });

      const result = await sendEmailWithAudit({
        to: recipient.email,
        subject: scheduledEmail.subject,
        html,
        userId: recipient.id,
        emailType,
        triggerSource: 'scheduled',
        templateVersion: ANNOUNCEMENT_TEMPLATE_VERSION,
      });

      results[result.status]++;
    } catch (error) {
      results.failed++;
      console.error(`[EmailScheduler] Failed to send to ${recipient.email}:`, error);
    }
  }

  // Update the scheduled email with final results
  const finalStatus = results.failed === recipients.length ? 'failed' : 'sent';

  await prisma.scheduledEmail.update({
    where: { id: scheduledEmailId },
    data: {
      status: finalStatus,
      sentCount: results.sent,
      failedCount: results.failed,
      suppressedCount: results.suppressed,
      processedAt: new Date(),
      errorMessage: results.failed > 0 ? `${results.failed} emails failed to send` : null,
    },
  });

  console.log(
    `[EmailScheduler] Completed scheduled email ${scheduledEmailId}: ` +
      `sent=${results.sent}, failed=${results.failed}, suppressed=${results.suppressed}`
  );
}

/**
 * Check for and process due scheduled emails.
 */
async function checkDueEmails(): Promise<void> {
  // Prevent overlapping runs
  if (isProcessing) {
    console.log('[EmailScheduler] Previous check still running, skipping');
    return;
  }

  isProcessing = true;

  try {
    // Find all pending scheduled emails that are due
    const dueEmails = await prisma.scheduledEmail.findMany({
      where: {
        status: 'pending',
        scheduledFor: { lte: new Date() },
      },
      select: { id: true },
      orderBy: { scheduledFor: 'asc' },
      take: 10, // Process max 10 at a time to avoid long-running checks
    });

    if (dueEmails.length > 0) {
      console.log(`[EmailScheduler] Found ${dueEmails.length} due emails to process`);

      for (const email of dueEmails) {
        try {
          await processScheduledEmail(email.id);
        } catch (error) {
          console.error(`[EmailScheduler] Error processing email ${email.id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('[EmailScheduler] Error checking for due emails:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the email scheduler.
 * Checks every minute for scheduled emails that are due.
 */
export function startEmailScheduler(): void {
  if (schedulerInterval) {
    console.log('[EmailScheduler] Already running');
    return;
  }

  console.log('[EmailScheduler] Starting (check interval: 60s)');

  // Run immediately on startup
  checkDueEmails();

  // Then check every minute
  schedulerInterval = setInterval(checkDueEmails, CHECK_INTERVAL_MS);
}

/**
 * Stop the email scheduler.
 */
export function stopEmailScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[EmailScheduler] Stopped');
  }
}
