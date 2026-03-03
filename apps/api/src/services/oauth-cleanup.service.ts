import { cleanupExpiredAttempts } from '../lib/oauthState';
import { createLogger } from '../lib/logger';

const log = createLogger('oauth-cleanup');

// Run cleanup every hour
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// Delete attempts that expired more than 24 hours ago
const EXPIRED_OLDER_THAN_HOURS = 24;

let cleanupInterval: NodeJS.Timeout | null = null;

async function runCleanup(): Promise<void> {
  try {
    const deleted = await cleanupExpiredAttempts(EXPIRED_OLDER_THAN_HOURS);
    if (deleted > 0) {
      log.info({ deleted }, 'Cleaned up expired OAuth attempts');
    }
  } catch (err) {
    log.error({ err }, 'OAuth attempt cleanup failed');
  }
}

export function startOAuthCleanup(): void {
  if (cleanupInterval) {
    log.info('Already running');
    return;
  }

  log.info('Starting OAuth attempt cleanup (hourly)');
  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

export function stopOAuthCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('Stopped OAuth attempt cleanup');
  }
}
