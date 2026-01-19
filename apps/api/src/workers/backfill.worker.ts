import { Worker, Job } from 'bullmq';
import { getQueueConnection } from '../lib/queue/connection';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import { prisma } from '../lib/prisma';
import { getValidGarminToken } from '../lib/garmin-token';
import { logError } from '../lib/logger';
import type { BackfillJobData, BackfillJobName } from '../lib/queue/backfill.queue';

const GARMIN_API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api';

// Garmin API limits backfill requests to 30-day chunks
const CHUNK_DAYS = 30;

/**
 * Process a backfill job.
 * Triggers Garmin API backfill requests which deliver activities via webhooks.
 */
async function processBackfillJob(job: Job<BackfillJobData, void, BackfillJobName>): Promise<void> {
  const { userId, provider, year } = job.data;

  console.log(`[BackfillWorker] Processing ${provider} backfill for year ${year}, user ${userId}`);

  // Update status to in_progress
  await prisma.backfillRequest.updateMany({
    where: {
      userId,
      provider,
      year,
      status: { not: 'completed' },
    },
    data: { status: 'in_progress', updatedAt: new Date() },
  });

  // Acquire distributed lock to prevent concurrent backfills for the same user/provider
  const lockResult = await acquireLock('backfill', provider, userId);

  if (!lockResult.acquired) {
    console.log(`[BackfillWorker] Could not acquire lock for ${provider}:${userId}, will retry`);
    throw new Error('Lock not available, will retry');
  }

  try {
    if (provider === 'garmin') {
      await processGarminBackfill(userId, year);
    } else {
      throw new Error(`Unsupported provider for backfill: ${provider}`);
    }

    console.log(`[BackfillWorker] Completed ${provider} backfill for year ${year}`);
  } catch (error) {
    logError(`BackfillWorker ${provider}/${year}`, error);

    // Mark as failed
    await prisma.backfillRequest.updateMany({
      where: { userId, provider, year },
      data: { status: 'failed', updatedAt: new Date() },
    });

    throw error; // Re-throw for BullMQ retry logic
  } finally {
    await releaseLock(lockResult.lockKey, lockResult.lockValue);
    console.log(`[BackfillWorker] Released lock for ${provider}:${userId}`);
  }
}

/**
 * Process Garmin backfill for a specific year.
 * Triggers the Garmin Wellness API backfill endpoint in 30-day chunks.
 * Activities are delivered asynchronously via webhooks.
 */
async function processGarminBackfill(userId: string, year: string): Promise<void> {
  const accessToken = await getValidGarminToken(userId);

  if (!accessToken) {
    throw new Error('Garmin token expired or not connected');
  }

  // Calculate date range
  const currentYear = new Date().getFullYear();
  let startDate: Date;
  let endDate: Date;

  if (year === 'ytd') {
    // Check for existing YTD backfill to enable incremental fetching
    const existingYtd = await prisma.backfillRequest.findUnique({
      where: { userId_provider_year: { userId, provider: 'garmin', year: 'ytd' } },
    });

    if (existingYtd?.backfilledUpTo && existingYtd.status === 'in_progress') {
      // Only use incremental logic if we have a previous completed backfill
      // Since we just set status to in_progress, check if backfilledUpTo exists
      // If it does, it means a previous backfill completed and we should continue from there
      const previousEndDate = existingYtd.backfilledUpTo;
      startDate = new Date(previousEndDate.getTime() + 1000);
    } else {
      startDate = new Date(currentYear, 0, 1); // Jan 1 00:00:00
    }
    endDate = new Date(); // Now
  } else {
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear) {
      throw new Error(`Invalid year: ${year}`);
    }
    startDate = new Date(yearNum, 0, 1); // Jan 1 00:00:00
    endDate = new Date(yearNum, 11, 31, 23, 59, 59); // Dec 31 23:59:59
  }

  console.log(`[BackfillWorker] Garmin backfill date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Trigger backfill in 30-day chunks
  let currentStartDate = new Date(startDate);
  let totalChunks = 0;
  const errors: string[] = [];

  while (currentStartDate < endDate) {
    const chunkEndDate = new Date(currentStartDate);
    chunkEndDate.setDate(chunkEndDate.getDate() + CHUNK_DAYS);
    const actualChunkEndDate = chunkEndDate > endDate ? endDate : chunkEndDate;

    const chunkStartSeconds = Math.floor(currentStartDate.getTime() / 1000);
    const chunkEndSeconds = Math.floor(actualChunkEndDate.getTime() / 1000);

    console.log(`[BackfillWorker] Triggering chunk: ${currentStartDate.toISOString()} to ${actualChunkEndDate.toISOString()}`);

    const url = `${GARMIN_API_BASE}/rest/backfill/activities?summaryStartTimeInSeconds=${chunkStartSeconds}&summaryEndTimeInSeconds=${chunkEndSeconds}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 202) {
        totalChunks++;
        console.log(`[BackfillWorker] Chunk ${totalChunks} accepted`);
      } else if (response.status === 409) {
        // Duplicate request - that's okay, Garmin already processing
        console.log(`[BackfillWorker] Chunk already in progress (409)`);
      } else if (response.status === 400) {
        const text = await response.text();
        const minStartDate = extractMinStartDate(text);
        if (minStartDate && minStartDate > currentStartDate) {
          console.warn(`[BackfillWorker] Adjusting start to Garmin min ${minStartDate.toISOString()}`);
          currentStartDate = new Date(Math.ceil(minStartDate.getTime() / 1000) * 1000);
          continue;
        }
        console.error(`[BackfillWorker] Chunk failed: ${response.status} ${text}`);
        errors.push(`Failed for ${currentStartDate.toISOString().split('T')[0]}: ${response.status}`);
      } else {
        const text = await response.text();
        console.error(`[BackfillWorker] Chunk failed: ${response.status} ${text}`);
        errors.push(`Failed for ${currentStartDate.toISOString().split('T')[0]}: ${response.status}`);
      }
    } catch (error) {
      logError('BackfillWorker chunk', error);
      errors.push(`Error for ${currentStartDate.toISOString().split('T')[0]}`);
    }

    currentStartDate = new Date(actualChunkEndDate);
  }

  console.log(`[BackfillWorker] Triggered ${totalChunks} backfill chunks for year ${year}`);

  // Update backfilledUpTo for YTD
  if (year === 'ytd') {
    await prisma.backfillRequest.updateMany({
      where: { userId, provider: 'garmin', year },
      data: { backfilledUpTo: endDate, updatedAt: new Date() },
    });
  }

  // If no chunks were triggered and we had errors, fail the job
  if (totalChunks === 0 && errors.length > 0) {
    throw new Error(`Failed to trigger any backfill chunks: ${errors.join(', ')}`);
  }

  // Note: Status will be updated to 'completed' by the webhook handler
  // when all activities have been delivered
}

/**
 * Extracts minimum start date from Garmin API 400 error response.
 */
function extractMinStartDate(errorText: string): Date | null {
  try {
    const parsed = JSON.parse(errorText);
    const message =
      typeof parsed?.errorMessage === 'string' ? parsed.errorMessage : String(parsed ?? '');
    const match = message.match(/min start time of ([0-9T:.-]+Z)/i);
    if (match && match[1]) {
      const dt = new Date(match[1]);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
  } catch {
    // ignore JSON parse errors
  }
  return null;
}

// ============================================================================
// WORKER SINGLETON
// ============================================================================

let backfillWorker: Worker<BackfillJobData, void, BackfillJobName> | null = null;

/**
 * Create and start the backfill worker.
 */
export function createBackfillWorker(): Worker<BackfillJobData, void, BackfillJobName> {
  if (backfillWorker) {
    return backfillWorker;
  }

  backfillWorker = new Worker<BackfillJobData, void, BackfillJobName>(
    'backfill',
    processBackfillJob,
    {
      connection: getQueueConnection(),
      concurrency: 5, // Process up to 5 backfills concurrently
      drainDelay: 10000, // Wait 10s between empty polls
    }
  );

  backfillWorker.on('completed', (job) => {
    console.log(`[BackfillWorker] Job ${job.id} (${job.name}) completed for year ${job.data.year}`);
  });

  backfillWorker.on('failed', (job, err) => {
    console.error(
      `[BackfillWorker] Job ${job?.id} (${job?.name}) failed for year ${job?.data.year}:`,
      err.message
    );
  });

  backfillWorker.on('error', (err) => {
    console.error('[BackfillWorker] Worker error:', err.message);
  });

  console.log('[BackfillWorker] Started');
  return backfillWorker;
}

/**
 * Stop and close the backfill worker.
 */
export async function closeBackfillWorker(): Promise<void> {
  if (backfillWorker) {
    await backfillWorker.close();
    backfillWorker = null;
    console.log('[BackfillWorker] Stopped');
  }
}
