import { prisma } from '../lib/prisma';
import { sendEmailWithAudit } from './email.service';
import { getAnnouncementEmailHtml, ANNOUNCEMENT_TEMPLATE_VERSION } from '../templates/emails';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';
import { getRedisConnection, isRedisReady } from '../lib/redis';

const API_URL = process.env.API_URL || 'http://localhost:4000';

/** Delay helper for rate limiting */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay between emails to respect Resend's 1/second rate limit */
const EMAIL_SEND_DELAY_MS = 1100; // 1.1 seconds for safety margin

// Check for due emails every minute
const CHECK_INTERVAL_MS = 60 * 1000;

// Process recipients in batches to avoid memory issues
const RECIPIENT_BATCH_SIZE = 50;

// Lock TTL for scheduler (2 minutes - longer than check interval)
const SCHEDULER_LOCK_TTL_SECONDS = 120;

let schedulerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Acquire a distributed lock for the email scheduler.
 * Prevents multiple instances from processing the same emails.
 */
async function acquireSchedulerLock(): Promise<{ acquired: boolean; lockValue: string | null }> {
  if (!isRedisReady()) {
    // Redis unavailable - proceed but log warning
    console.warn('[EmailScheduler] Redis unavailable, proceeding without distributed lock');
    return { acquired: true, lockValue: null };
  }

  try {
    const redis = getRedisConnection();
    const lockKey = 'lock:email-scheduler:global';
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await redis.set(lockKey, lockValue, 'EX', SCHEDULER_LOCK_TTL_SECONDS, 'NX');

    if (result === 'OK') {
      return { acquired: true, lockValue };
    }

    return { acquired: false, lockValue: null };
  } catch (err) {
    console.warn(
      '[EmailScheduler] Redis error during lock acquisition, proceeding without lock:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return { acquired: true, lockValue: null };
  }
}

/**
 * Release the scheduler distributed lock.
 */
async function releaseSchedulerLock(lockValue: string | null): Promise<void> {
  if (!lockValue || !isRedisReady()) {
    return;
  }

  try {
    const redis = getRedisConnection();
    const lockKey = 'lock:email-scheduler:global';

    // Atomic check-and-delete using Lua script
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    await redis.eval(script, 1, lockKey, lockValue);
  } catch (err) {
    console.warn(
      '[EmailScheduler] Failed to release lock:',
      err instanceof Error ? err.message : 'Unknown error'
    );
  }
}

/**
 * Process a single scheduled email.
 * Sends emails to all recipients and updates the record with results.
 * Uses atomic status update to prevent race conditions in multi-instance deployments.
 */
async function processScheduledEmail(scheduledEmailId: string): Promise<void> {
  console.log(`[EmailScheduler] Processing scheduled email ${scheduledEmailId}`);

  // Use transaction to atomically claim and fetch - prevents orphaned "processing" records
  // if the record is deleted between claim and fetch
  const scheduledEmail = await prisma.$transaction(async (tx) => {
    // Atomic claim - only update if still pending
    const claimed = await tx.scheduledEmail.updateMany({
      where: {
        id: scheduledEmailId,
        status: 'pending',
      },
      data: { status: 'processing' },
    });

    if (claimed.count === 0) {
      return null; // Already claimed or not pending
    }

    // Fetch within same transaction - guaranteed to exist if claim succeeded
    return tx.scheduledEmail.findUnique({
      where: { id: scheduledEmailId },
    });
  });

  if (!scheduledEmail) {
    console.log(`[EmailScheduler] Email ${scheduledEmailId} already claimed or not pending, skipping`);
    return;
  }

  const results = {
    sent: 0,
    failed: 0,
    suppressed: 0,
  };

  const recipientIds = scheduledEmail.recipientIds;

  if (recipientIds.length === 0) {
    console.error(`[EmailScheduler] No recipients for scheduled email ${scheduledEmailId}`);
    await prisma.scheduledEmail.update({
      where: { id: scheduledEmailId },
      data: {
        status: 'failed',
        errorMessage: 'No recipients specified',
        processedAt: new Date(),
      },
    });
    return;
  }

  const emailType = scheduledEmail.templateType === 'announcement' ? 'announcement' : 'custom';

  // Process recipients in batches to avoid memory issues with large recipient lists
  for (let i = 0; i < recipientIds.length; i += RECIPIENT_BATCH_SIZE) {
    const batchIds = recipientIds.slice(i, i + RECIPIENT_BATCH_SIZE);

    const recipients = await prisma.user.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        email: true,
        name: true,
        emailUnsubscribed: true,
      },
    });

    // Send emails sequentially within batch with delay to respect provider rate limits
    for (let j = 0; j < recipients.length; j++) {
      const recipient = recipients[j];

      // Add delay between emails (except before first in each batch)
      if (j > 0) {
        await sleep(EMAIL_SEND_DELAY_MS);
      }

      try {
        const unsubscribeToken = generateUnsubscribeToken(recipient.id);
        const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

        const html = await getAnnouncementEmailHtml({
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
  }

  // Update the scheduled email with final results
  const totalProcessed = results.sent + results.failed + results.suppressed;
  const finalStatus = totalProcessed === 0 || results.failed === totalProcessed ? 'failed' : 'sent';

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
 * Uses distributed lock to prevent multiple instances from processing simultaneously.
 */
async function checkDueEmails(): Promise<void> {
  // Prevent overlapping runs on same instance
  if (isProcessing) {
    console.log('[EmailScheduler] Previous check still running, skipping');
    return;
  }

  // Acquire distributed lock for multi-instance safety
  const lock = await acquireSchedulerLock();
  if (!lock.acquired) {
    // Another instance is processing
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
    await releaseSchedulerLock(lock.lockValue);
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
 * Stop the email scheduler gracefully.
 * Waits for any in-flight email processing to complete (up to 30 seconds).
 */
export async function stopEmailScheduler(): Promise<void> {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;

    // Wait for in-flight processing to complete (max 30 seconds)
    if (isProcessing) {
      console.log('[EmailScheduler] Waiting for in-flight processing to complete...');
      let waitCount = 0;
      const maxWait = 30;

      while (isProcessing && waitCount < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        waitCount++;
      }

      if (isProcessing) {
        console.warn('[EmailScheduler] Forced stop while still processing');
      } else {
        console.log('[EmailScheduler] Stopped gracefully');
      }
    } else {
      console.log('[EmailScheduler] Stopped');
    }
  }
}
