import { prisma } from '../lib/prisma';

/** Recent auth window: 10 minutes */
export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

export type RecentAuthCheckResult =
  | { valid: true; lastAuthAt: Date }
  | { valid: false; reason: 'NEVER_AUTHENTICATED' | 'AUTH_EXPIRED'; lastAuthAt: Date | null };

/**
 * Check if user has authenticated within the recent auth window.
 * Used to gate sensitive operations like adding/changing passwords.
 *
 * @param userId - The user ID to check
 * @param sessionAuthAt - Optional fallback timestamp from session JWT (epoch ms).
 *                        Used if DB lastAuthAt is missing/stale (e.g., if DB write failed).
 */
export async function checkRecentAuth(
  userId: string,
  sessionAuthAt?: number
): Promise<RecentAuthCheckResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastAuthAt: true },
  });

  const now = Date.now();

  // Use DB lastAuthAt if available, otherwise fall back to session authAt
  let lastAuthTime: number | null = null;
  let lastAuthAt: Date | null = null;

  if (user?.lastAuthAt) {
    lastAuthAt = user.lastAuthAt;
    lastAuthTime = user.lastAuthAt.getTime();
  } else if (sessionAuthAt) {
    // Fallback to session timestamp (handles DB write failure on login)
    lastAuthAt = new Date(sessionAuthAt);
    lastAuthTime = sessionAuthAt;
  }

  if (lastAuthTime === null) {
    return { valid: false, reason: 'NEVER_AUTHENTICATED', lastAuthAt: null };
  }

  const elapsed = now - lastAuthTime;

  if (elapsed > RECENT_AUTH_WINDOW_MS) {
    return { valid: false, reason: 'AUTH_EXPIRED', lastAuthAt };
  }

  return { valid: true, lastAuthAt };
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
