import { prisma } from '../lib/prisma';
import { getRedisConnection, isRedisReady } from '../lib/redis';
import { logger } from '../lib/logger';

// Check for idle sessions every minute
const CHECK_INTERVAL_MS = 60 * 1000;

// Sessions are considered idle after 10 minutes of no new activities
const IDLE_WINDOW_MS = 10 * 60 * 1000;

// Sessions with no activity received within 30 min of start are considered stale
const STALE_SESSION_MS = 30 * 60 * 1000;

// Lock TTL for checker (2 minutes - longer than check interval)
const CHECKER_LOCK_TTL_SECONDS = 120;

let checkerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

/**
 * Acquire a distributed lock for the import session checker.
 * Prevents multiple instances from processing the same sessions.
 */
async function acquireCheckerLock(): Promise<{ acquired: boolean; lockValue: string | null }> {
  if (!isRedisReady()) {
    // Redis unavailable - proceed but log warning
    logger.warn('[ImportSessionChecker] Redis unavailable, proceeding without distributed lock');
    return { acquired: true, lockValue: null };
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
      '[ImportSessionChecker] Redis error during lock acquisition, proceeding without lock'
    );
    return { acquired: true, lockValue: null };
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

    // Find sessions that have received at least one activity but are now idle
    const idleSessions = await prisma.importSession.findMany({
      where: {
        status: 'running',
        lastActivityReceivedAt: { not: null, lte: idleCutoff },
      },
      select: { id: true },
    });

    if (idleSessions.length > 0) {
      logger.info({ count: idleSessions.length }, '[ImportSessionChecker] Found idle sessions to complete');

      for (const session of idleSessions) {
        try {
          // Count unassigned rides for this session
          const unassignedCount = await prisma.ride.count({
            where: { importSessionId: session.id, bikeId: null },
          });

          await prisma.importSession.update({
            where: { id: session.id },
            data: {
              status: 'completed',
              completedAt: now,
              unassignedRideCount: unassignedCount,
            },
          });

          logger.info(
            { sessionId: session.id, unassignedCount },
            '[ImportSessionChecker] Completed idle import session'
          );
        } catch (error) {
          logger.error(
            { sessionId: session.id, error: error instanceof Error ? error.message : 'Unknown error' },
            '[ImportSessionChecker] Error completing session'
          );
        }
      }
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
 * Waits for any in-flight processing to complete (up to 30 seconds).
 */
export async function stopImportSessionChecker(): Promise<void> {
  if (checkerInterval) {
    clearInterval(checkerInterval);
    checkerInterval = null;

    // Wait for in-flight processing to complete (max 30 seconds)
    if (isProcessing) {
      logger.info('[ImportSessionChecker] Waiting for in-flight processing to complete...');
      let waitCount = 0;
      const maxWait = 30;

      while (isProcessing && waitCount < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        waitCount++;
      }

      if (isProcessing) {
        logger.warn('[ImportSessionChecker] Forced stop while still processing');
      } else {
        logger.info('[ImportSessionChecker] Stopped gracefully');
      }
    } else {
      logger.info('[ImportSessionChecker] Stopped');
    }
  }
}
