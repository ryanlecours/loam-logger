import { deleteDefunctMobileSessions } from '../auth/mobile-session';
import { createLogger } from '../lib/logger';

const log = createLogger('mobile-session-cleanup');

// Sessions churn slowly (one row per device sign-in, 365-day sliding
// expiry), so a daily sweep is plenty; the table would otherwise grow
// unbounded from revoked sessions, expired sessions, and one-shot
// legacy-upgrade rows.
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Keep revoked/expired rows for 30 days before deletion: a reuse-detection
// revocation is precisely the row you want available while investigating.
const DEFUNCT_OLDER_THAN_DAYS = 30;

let cleanupInterval: NodeJS.Timeout | null = null;

async function runCleanup(): Promise<void> {
  try {
    const deleted = await deleteDefunctMobileSessions(DEFUNCT_OLDER_THAN_DAYS);
    if (deleted > 0) {
      log.info({ deleted }, 'Cleaned up defunct mobile sessions');
    }
  } catch (err) {
    log.error({ err }, 'Mobile session cleanup failed');
  }
}

export function startMobileSessionCleanup(): void {
  if (cleanupInterval) {
    log.info('Already running');
    return;
  }

  log.info('Starting mobile session cleanup (daily)');
  // Run once immediately so a fresh deploy doesn't wait a full interval
  // before pruning the table.
  void runCleanup();
  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

export function stopMobileSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('Stopped mobile session cleanup');
  }
}
