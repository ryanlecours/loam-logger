import { cleanupExpiredPasswordResetTokens } from './password-reset.service';
import { createLogger } from '../lib/logger';

const log = createLogger('password-reset-cleanup');

// Run cleanup once a day
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Delete tokens that expired more than 7 days ago — keeps the recent history
// around for forensic lookup (e.g. "when was the last reset sent?") without
// letting the table grow unbounded.
const EXPIRED_OLDER_THAN_HOURS = 7 * 24;

let cleanupInterval: NodeJS.Timeout | null = null;

async function runCleanup(): Promise<void> {
  try {
    const deleted = await cleanupExpiredPasswordResetTokens(EXPIRED_OLDER_THAN_HOURS);
    if (deleted > 0) {
      log.info({ deleted }, 'Cleaned up expired password reset tokens');
    }
  } catch (err) {
    log.error({ err }, 'Password reset token cleanup failed');
  }
}

export function startPasswordResetCleanup(): void {
  if (cleanupInterval) {
    log.info('Already running');
    return;
  }

  log.info('Starting password reset token cleanup (daily)');
  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

export function stopPasswordResetCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('Stopped password reset token cleanup');
  }
}
