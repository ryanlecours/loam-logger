/**
 * Automatic ride import after a provider connect.
 *
 * Connecting a provider used to store tokens and stop: past rides arrived
 * only when the rider found the manual Sync in Settings, and new rides only
 * when the next webhook fired. A rider who did everything right landed on a
 * dashboard with nothing on the clock. This module makes "connected" mean
 * "hours are on the way": the OAuth callbacks call `startAutoImport` once the
 * tokens are stored, and it queues the same backfill the Settings import
 * would, for a rolling window of the last 365 days.
 *
 * The window is the same for every tier. `canBackfillYear` already lets free
 * accounts run the rolling day windows, since a window ending today is not
 * the "past seasons" capability Pro sells.
 *
 * Nothing here throws: the callback must still redirect the rider, so a Redis
 * outage or a stale request row is logged and reported in the result instead.
 */

import { prisma } from './prisma';
import { logError, logger } from './logger';
import { enqueueBackfillJob } from './queue/backfill.queue';
import { enqueueSyncJob } from './queue/sync.queue';
import { captureServerEvent, type RideProvider } from './posthog';

/** The rolling window queued after a connect. Must be a key of GARMIN_PERIOD_DAYS. */
export const AUTO_IMPORT_PERIOD = '365d';

export type AutoImportResult =
  | { status: 'queued'; jobId: string }
  | { status: 'already_queued'; jobId: string }
  | { status: 'skipped'; reason: 'in_progress' }
  | { status: 'failed' };

/**
 * Queue the import for a provider the rider has just connected. Safe to call
 * on a reconnect too: a window already pending or running is left alone, and
 * a finished one is re-run, which is what a rider reconnecting after a gap
 * wants.
 */
export async function startAutoImport(userId: string, provider: RideProvider): Promise<AutoImportResult> {
  let result: AutoImportResult;
  try {
    result = provider === 'whoop' ? await startWhoopSync(userId) : await startBackfill(userId, provider);
  } catch (err) {
    logError(`Auto import ${provider}`, err);
    result = { status: 'failed' };
  }

  captureServerEvent(userId, 'auto_import_started', {
    provider,
    period: provider === 'whoop' ? '30d' : AUTO_IMPORT_PERIOD,
    status: result.status,
  });
  logger.info({ userId, provider, result }, '[AutoImport] Connect import handled');
  return result;
}

/**
 * WHOOP has no history import; its `syncLatest` job already covers the last
 * 30 days, which is as far back as the Settings page offers either.
 */
async function startWhoopSync(userId: string): Promise<AutoImportResult> {
  const result = await enqueueSyncJob('syncLatest', { userId, provider: 'whoop' });
  return { status: result.status, jobId: result.jobId };
}

async function startBackfill(userId: string, provider: 'garmin' | 'strava' | 'suunto'): Promise<AutoImportResult> {
  const year = AUTO_IMPORT_PERIOD;

  // A window still pending or running is left to finish. The import-session
  // checker fails a request that has sat untouched for an hour, so a stale
  // row never blocks the next connect for good.
  const inFlight = await prisma.backfillRequest.findFirst({
    where: { userId, provider, year, status: { in: ['pending', 'in_progress'] } },
    select: { id: true },
  });
  if (inFlight) {
    return { status: 'skipped', reason: 'in_progress' };
  }

  // Garmin and Suunto rides are tagged with a running ImportSession so the
  // clients can show import progress, the same as the batch routes do. Strava
  // imports complete inside the job, so the route never used one.
  if (provider !== 'strava') {
    const running = await prisma.importSession.findFirst({
      where: { userId, provider, status: 'running' },
      select: { id: true },
    });
    if (!running) {
      await prisma.importSession.create({
        data: { userId, provider, status: 'running', startedAt: new Date() },
      });
    }
  }

  await prisma.backfillRequest.upsert({
    where: { userId_provider_year: { userId, provider, year } },
    update: { status: 'pending', updatedAt: new Date() },
    create: { userId, provider, year, status: 'pending' },
  });

  // If the enqueue fails the request row already says pending with no job
  // behind it, so mark it failed rather than leave it phantom-pending.
  try {
    const result = await enqueueBackfillJob({ userId, provider, year });
    return { status: result.status, jobId: result.jobId };
  } catch (err) {
    await prisma.backfillRequest.updateMany({
      where: { userId, provider, year },
      data: { status: 'failed', updatedAt: new Date() },
    });
    throw err;
  }
}
