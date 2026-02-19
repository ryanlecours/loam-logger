import { prisma } from '../lib/prisma';

/** Recent auth window: 10 minutes */
const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

export type RecentAuthCheckResult =
  | { valid: true; lastAuthAt: Date }
  | { valid: false; reason: 'NEVER_AUTHENTICATED' | 'AUTH_EXPIRED'; lastAuthAt: Date | null };

/**
 * Check if user has authenticated within the recent auth window.
 * Used to gate sensitive operations like adding/changing passwords.
 */
export async function checkRecentAuth(userId: string): Promise<RecentAuthCheckResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastAuthAt: true },
  });

  if (!user?.lastAuthAt) {
    return { valid: false, reason: 'NEVER_AUTHENTICATED', lastAuthAt: null };
  }

  const now = Date.now();
  const lastAuthTime = user.lastAuthAt.getTime();
  const elapsed = now - lastAuthTime;

  if (elapsed > RECENT_AUTH_WINDOW_MS) {
    return { valid: false, reason: 'AUTH_EXPIRED', lastAuthAt: user.lastAuthAt };
  }

  return { valid: true, lastAuthAt: user.lastAuthAt };
}

/**
 * Update the lastAuthAt timestamp for a user.
 * Called on successful authentication (login, Google OAuth).
 * Should NOT be called on token refresh.
 */
export async function updateLastAuthAt(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastAuthAt: new Date() },
  });
}

/** Export the window constant for testing */
export const RECENT_AUTH_WINDOW_MS_EXPORT = RECENT_AUTH_WINDOW_MS;
