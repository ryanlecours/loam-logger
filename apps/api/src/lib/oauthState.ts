import { prisma } from './prisma';
import { randomString, sha256 } from './pcke';
import { addMinutes } from 'date-fns';
import type { IntegrationProvider, OAuthPlatform, OAuthAttempt } from '@prisma/client';

const ATTEMPT_TTL_MINUTES = 10;

/**
 * Create an OAuthAttempt record for mobile OAuth flows.
 *
 * @param includeVerifier - If true, generates a PKCE code_verifier stored in nonce (for Garmin).
 *                          If false, stores empty string (for Strava which has no PKCE).
 */
export async function createOAuthAttempt(params: {
  userId: string;
  provider: IntegrationProvider;
  platform: OAuthPlatform;
  includeVerifier?: boolean;
}): Promise<{ state: string; verifier: string; attempt: OAuthAttempt }> {
  const { userId, provider, platform, includeVerifier = false } = params;

  const state = randomString(32);
  const verifier = includeVerifier ? randomString(64) : '';
  const stateHash = await sha256(state);

  const attempt = await prisma.oAuthAttempt.create({
    data: {
      provider,
      userId,
      platform,
      stateHash,
      nonce: verifier,
      expiresAt: addMinutes(new Date(), ATTEMPT_TTL_MINUTES),
    },
  });

  return { state, verifier, attempt };
}

/**
 * Atomically validate and consume an OAuthAttempt in a single operation.
 * Uses updateMany to claim the attempt (prevents TOCTOU race where concurrent
 * callbacks with the same state could both pass a read-then-write check).
 * Returns the attempt and its stored verifier (nonce) if valid, or null.
 */
export async function consumeOAuthAttempt(params: {
  state: string;
  provider: IntegrationProvider;
}): Promise<{ attempt: OAuthAttempt; verifier: string } | null> {
  const { state, provider } = params;
  const stateHash = await sha256(state);
  const now = new Date();

  // Atomic claim: only one concurrent caller can set usedAt on a given row
  const updated = await prisma.oAuthAttempt.updateMany({
    where: {
      stateHash,
      provider,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  if (updated.count === 0) {
    return null;
  }

  // Fetch the claimed attempt for its data (userId, nonce, etc.)
  const attempt = await prisma.oAuthAttempt.findFirst({
    where: { stateHash, provider, usedAt: now },
  });

  if (!attempt) {
    return null;
  }

  return { attempt, verifier: attempt.nonce };
}

/**
 * Delete OAuthAttempt records that expired more than `olderThanHours` hours ago.
 * Returns the number of deleted rows.
 */
export async function cleanupExpiredAttempts(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await prisma.oAuthAttempt.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
