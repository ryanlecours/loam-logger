import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { deleteUserAccount } from './account-deletion.service';
import {
  cleanupExpiredEmailVerificationTokens,
  UNVERIFIED_ACCOUNT_TTL_DAYS,
} from './email-verification.service';

const log = createLogger('unverified-account-cleanup');

// Run cleanup once a day
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Keep expired verification tokens for a week, like password reset tokens,
// so "was a link ever sent?" can still be answered for a recent signup.
const EXPIRED_TOKENS_OLDER_THAN_HOURS = 7 * 24;

// Upper bound per run, so a backlog drains over a few days instead of one
// long loop of deletions at boot.
const PURGE_BATCH_SIZE = 500;

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Delete gated accounts that never verified within `olderThanDays`.
 *
 * Only accounts with emailVerificationRequired are candidates, so nothing
 * created before verification shipped is touched. Such an account has never
 * held a session, so it has no rides, integrations or billing of its own; the
 * shared deletion service still runs so teardown stays in one place. Returns
 * the number of accounts deleted.
 */
export async function purgeUnverifiedAccounts(olderThanDays = UNVERIFIED_ACCOUNT_TTL_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const stale = await prisma.user.findMany({
    where: {
      emailVerificationRequired: true,
      emailVerified: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true },
    take: PURGE_BATCH_SIZE,
  });

  let deleted = 0;
  for (const { id } of stale) {
    try {
      await deleteUserAccount(id);
      deleted++;
    } catch (err) {
      log.error({ err, userId: id }, 'Unverified account purge failed');
    }
  }
  return deleted;
}

async function runCleanup(): Promise<void> {
  try {
    const purged = await purgeUnverifiedAccounts(UNVERIFIED_ACCOUNT_TTL_DAYS);
    if (purged > 0) {
      log.info({ purged }, 'Deleted accounts that never verified their email');
    }
    const tokens = await cleanupExpiredEmailVerificationTokens(EXPIRED_TOKENS_OLDER_THAN_HOURS);
    if (tokens > 0) {
      log.info({ deleted: tokens }, 'Cleaned up expired email verification tokens');
    }
  } catch (err) {
    log.error({ err }, 'Unverified account cleanup failed');
  }
}

export function startUnverifiedAccountCleanup(): void {
  if (cleanupInterval) {
    log.info('Already running');
    return;
  }

  log.info(`Starting unverified account cleanup (daily, ${UNVERIFIED_ACCOUNT_TTL_DAYS}-day window)`);
  // Run once immediately so a fresh deploy doesn't wait a full interval.
  void runCleanup();
  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

export function stopUnverifiedAccountCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info('Stopped unverified account cleanup');
  }
}
