import type { AuthProvider } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getRedisConnection, isRedisReady } from '../lib/redis';
import { logger } from '../lib/logger';

// Check for idle sessions every minute
const CHECK_INTERVAL_MS = 60 * 1000;

// Sessions are considered idle after 10 minutes of no new activities
const IDLE_WINDOW_MS = 10 * 60 * 1000;

// Sessions with no activity received within 30 min of start are considered stale
const STALE_SESSION_MS = 30 * 60 * 1000;

// Sessions stuck in running state for 24+ hours are considered failed (worker crash, etc.)
const STUCK_SESSION_MS = 24 * 60 * 60 * 1000;

// A BackfillRequest that has sat in pending/in_progress this long with nothing
// touching it is not coming back. Garmin's async delivery is the slow case and
// it lands in tens of minutes, so an hour of silence means the request died.
const STALE_BACKFILL_MS = 60 * 60 * 1000;

// Lock TTL for checker (2 minutes - longer than check interval)
const CHECKER_LOCK_TTL_SECONDS = 120;

let checkerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;
let shouldAbort = false;

/**
 * Acquire a distributed lock for the import session checker.
 * Prevents multiple instances from processing the same sessions.
 */
async function acquireCheckerLock(): Promise<{ acquired: boolean; lockValue: string | null }> {
  if (!isRedisReady()) {
    // Redis unavailable - skip processing to avoid race conditions with other instances
    logger.warn('[ImportSessionChecker] Redis unavailable, skipping to prevent race conditions');
    return { acquired: false, lockValue: null };
  }

  try {
    const redis = getRedisConnection();
    const lockKey = 'lock:import-session-checker:global';
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await redis.set(lockKey, lockValue, 'EX', CHECKER_LOCK_TTL_SECONDS, 'NX');

    if (result === 'OK') {
      return { acquired: true, lockValue };
    }

    return { acquired: false, lockValue: null };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      '[ImportSessionChecker] Redis error during lock acquisition, skipping to prevent race conditions'
    );
    return { acquired: false, lockValue: null };
  }
}

/**
 * Release the checker distributed lock.
 */
async function releaseCheckerLock(lockValue: string | null): Promise<void> {
  if (!lockValue || !isRedisReady()) {
    return;
  }

  try {
    const redis = getRedisConnection();
    const lockKey = 'lock:import-session-checker:global';

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
    logger.warn(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      '[ImportSessionChecker] Failed to release lock'
    );
  }
}

/**
 * Move a user's non-terminal BackfillRequests for one provider to a final state.
 *
 * This is the missing half of the Garmin backfill's state machine. The backfill
 * worker sets a row to `in_progress` and then defers, with the comment "Status
 * will be updated to 'completed' by the webhook handler when all activities
 * have been delivered". No webhook handler ever did that, so a Garmin backfill
 * that actually triggered chunks stayed `in_progress` forever, and both clients
 * gate their sync UI on exactly that status. The only offered option is `ytd`,
 * so one stuck row disabled the whole screen with a permanent "Sync in
 * progress" spinner that no amount of waiting cleared.
 *
 * Strava and Suunto do not have this hole: Strava's backfill is synchronous and
 * marks itself completed inline, and Suunto's worker closes its own row.
 *
 * Called only from session completion, where the session is the evidence: it
 * received activities and then went quiet, which is the definition the worker's
 * comment was reaching for.
 *
 * SCOPE: `in_progress` only, deliberately never `pending`. The batch endpoint
 * writes `pending` and the worker flips it to `in_progress` as the first thing
 * it does, so a `pending` row is one whose job has not started: it may be
 * queued behind a rate-limit backoff and has certainly not fetched anything.
 * Completing it would be the same "completed but never happened" bug the stale
 * sweep below goes out of its way to avoid, and it would be worse there,
 * because the single-year guard only lets a year be retried while it is
 * `failed`. Leaving those rows alone lets a job that eventually runs finish
 * normally, and lets one that never runs fall to the stale sweep and become
 * retryable.
 *
 * ASSUMPTION, worth knowing if Garmin batch backfill is ever surfaced: this is
 * still scoped by (userId, provider) rather than to the specific years tied to
 * the session, because BackfillRequest has no link back to ImportSession and
 * one session covers a whole batch. Today `POST /garmin/backfill/batch` accepts
 * up to 10 years but both clients only ever send `ytd`, so there is one
 * non-terminal row per user and the coarse scope is exact. If a client starts
 * sending several years, two of them can be `in_progress` under one session
 * while only one is actually delivering, and the quiet one would be completed
 * early. Fixing that properly means putting an importSessionId on
 * BackfillRequest and matching on it here.
 */
async function settleBackfillRequests(
  userId: string,
  provider: AuthProvider,
  now: Date
): Promise<void> {
  try {
    const result = await prisma.backfillRequest.updateMany({
      where: { userId, provider, status: 'in_progress' },
      data: { status: 'completed', completedAt: now, updatedAt: now },
    });

    if (result.count > 0) {
      logger.info(
        { userId, provider, count: result.count },
        '[ImportSessionChecker] Settled backfill requests after session completed'
      );
    }
  } catch (error) {
    // The session is already closed and that is the record that matters most.
    // A failure here leaves the row for the stale sweep below to catch.
    logger.error(
      { userId, provider, error: error instanceof Error ? error.message : 'Unknown error' },
      '[ImportSessionChecker] Failed to settle backfill requests'
    );
  }
}

/**
 * Check for and complete idle import sessions.
 * A session is considered idle if no new activities have been received
 * within the idle window (10 minutes).
 */
async function checkIdleSessions(): Promise<void> {
  // Prevent overlapping runs on same instance
  if (isProcessing) {
    logger.debug('[ImportSessionChecker] Previous check still running, skipping');
    return;
  }

  // Acquire distributed lock for multi-instance safety
  const lock = await acquireCheckerLock();
  if (!lock.acquired) {
    // Another instance is processing
    return;
  }

  isProcessing = true;

  try {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - IDLE_WINDOW_MS);
    const staleCutoff = new Date(now.getTime() - STALE_SESSION_MS);

    // Find sessions that have received at least one activity but are now idle.
    // userId and provider come along so the matching BackfillRequest rows can be
    // settled too: for Garmin nothing else ever will. See settleBackfillRequests.
    const idleSessions = await prisma.importSession.findMany({
      where: {
        status: 'running',
        lastActivityReceivedAt: { not: null, lte: idleCutoff },
      },
      select: { id: true, userId: true, provider: true },
    });

    if (idleSessions.length > 0) {
      logger.info({ count: idleSessions.length }, '[ImportSessionChecker] Found idle sessions to complete');

      for (const session of idleSessions) {
        // Check for abort signal before each DB operation
        if (shouldAbort) {
          logger.info('[ImportSessionChecker] Aborting due to shutdown request');
          return;
        }

        try {
          // Atomically count unassigned rides and update session in a single query
          // This prevents race conditions if user assigns bikes between count and update
          const result = await prisma.$executeRaw`
            UPDATE "ImportSession"
            SET
              status = 'completed',
              "completedAt" = ${now},
              "unassignedRideCount" = (
                SELECT COUNT(*) FROM "Ride"
                WHERE "importSessionId" = ${session.id} AND "bikeId" IS NULL
              ),
              "updatedAt" = ${now}
            WHERE id = ${session.id} AND status = 'running'
          `;

          if (result > 0) {
            // Fetch the updated count for logging
            const updated = await prisma.importSession.findUnique({
              where: { id: session.id },
              select: { unassignedRideCount: true },
            });

            logger.info(
              { sessionId: session.id, unassignedCount: updated?.unassignedRideCount ?? 0 },
              '[ImportSessionChecker] Completed idle import session'
            );

            // The session delivered activities and then went quiet, so the
            // backfill behind it is done. Guarded on result > 0 so only the
            // instance that actually won the session update settles the rows.
            await settleBackfillRequests(session.userId, session.provider, now);
          }
        } catch (error) {
          logger.error(
            { sessionId: session.id, error: error instanceof Error ? error.message : 'Unknown error' },
            '[ImportSessionChecker] Error completing session'
          );
        }
      }
    }

    // Check for abort before stale session cleanup
    if (shouldAbort) {
      logger.info('[ImportSessionChecker] Aborting due to shutdown request');
      return;
    }

    // Also complete stale sessions that never received any activities
    const staleResult = await prisma.importSession.updateMany({
      where: {
        status: 'running',
        lastActivityReceivedAt: null,
        startedAt: { lte: staleCutoff },
      },
      data: {
        status: 'completed',
        completedAt: now,
        unassignedRideCount: 0,
      },
    });

    if (staleResult.count > 0) {
      logger.info(
        { count: staleResult.count },
        '[ImportSessionChecker] Completed stale sessions with no activity'
      );
    }

    // Check for abort before stuck session cleanup
    if (shouldAbort) {
      logger.info('[ImportSessionChecker] Aborting due to shutdown request');
      return;
    }

    // Clean up stuck sessions (running > 24 hours, likely from worker crash)
    const stuckCutoff = new Date(now.getTime() - STUCK_SESSION_MS);
    const stuckResult = await prisma.importSession.updateMany({
      where: {
        status: 'running',
        startedAt: { lte: stuckCutoff },
      },
      data: {
        status: 'failed',
        completedAt: now,
        unassignedRideCount: 0,
      },
    });

    if (stuckResult.count > 0) {
      logger.warn(
        { count: stuckResult.count },
        '[ImportSessionChecker] Marked stuck sessions as failed (running > 24h)'
      );
    }

    // Check for abort before backfill cleanup
    if (shouldAbort) {
      logger.info('[ImportSessionChecker] Aborting due to shutdown request');
      return;
    }

    // Sweep BackfillRequests that never reached a terminal state. Catches rows
    // already stuck before the settlement above existed, and any future path
    // that fails to close its own row.
    //
    // Marked `failed`, not `completed`, and the distinction is load-bearing.
    // The YTD guard only resumes from `backfilledUpTo` when the previous row
    // says `completed`, so calling an unfinished backfill complete would skip
    // straight past activities that never arrived and lose them silently.
    // `failed` restarts the range from the beginning; Garmin answers 409 for
    // anything it already delivered, which the all-duplicates path handles.
    // Both clients treat `failed` as retryable, so this is what unblocks the
    // spinner.
    const staleBackfillCutoff = new Date(now.getTime() - STALE_BACKFILL_MS);
    const staleBackfills = await prisma.backfillRequest.updateMany({
      where: {
        status: { in: ['pending', 'in_progress'] },
        updatedAt: { lte: staleBackfillCutoff },
      },
      data: { status: 'failed', updatedAt: now },
    });

    if (staleBackfills.count > 0) {
      logger.warn(
        { count: staleBackfills.count },
        '[ImportSessionChecker] Marked stale backfill requests as failed (no progress in 1h)'
      );
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      '[ImportSessionChecker] Error checking for idle sessions'
    );
  } finally {
    isProcessing = false;
    await releaseCheckerLock(lock.lockValue);
  }
}

/**
 * Start the import session checker.
 * Checks every minute for sessions that are idle and should be completed.
 */
export function startImportSessionChecker(): void {
  if (checkerInterval) {
    logger.info('[ImportSessionChecker] Already running');
    return;
  }

  logger.info('[ImportSessionChecker] Starting (check interval: 60s, idle window: 10 min)');

  // Run immediately on startup
  checkIdleSessions();

  // Then check every minute
  checkerInterval = setInterval(checkIdleSessions, CHECK_INTERVAL_MS);
}

/**
 * Stop the import session checker gracefully.
 * Waits for any in-flight processing to complete (up to 10 seconds).
 * Reduced from 30s to avoid delaying container orchestration shutdown (K8s, ECS).
 */
export async function stopImportSessionChecker(): Promise<void> {
  if (checkerInterval) {
    clearInterval(checkerInterval);
    checkerInterval = null;

    // Signal abort to any in-flight processing
    shouldAbort = true;

    // Wait for in-flight processing to complete (max 10 seconds)
    if (isProcessing) {
      logger.info('[ImportSessionChecker] Shutdown requested, waiting for in-flight processing...');
      let waitCount = 0;
      const maxWait = 10;

      while (isProcessing && waitCount < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        waitCount++;
      }

      if (isProcessing) {
        logger.warn(
          { waitedSeconds: waitCount },
          '[ImportSessionChecker] Forced shutdown - processing still in progress'
        );
      } else {
        logger.info({ waitedSeconds: waitCount }, '[ImportSessionChecker] Stopped gracefully');
      }
    } else {
      logger.info('[ImportSessionChecker] Stopped');
    }

    // Reset abort flag for potential restart
    shouldAbort = false;
  }
}
