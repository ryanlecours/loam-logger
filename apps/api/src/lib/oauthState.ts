import { prisma } from './prisma';
import { randomString, sha256 } from './pcke';
import { addMinutes } from 'date-fns';
import type { IntegrationProvider, OAuthPlatform, OAuthAttempt } from '@prisma/client';

const ATTEMPT_TTL_MINUTES = 10;

/**
 * Prefix on the `state` token of a mobile OAuth attempt.
 *
 * The attempt row is the only thing that says a callback is mobile, and the
 * row is gone once the attempt expires or is replayed. Without a second
 * signal the callback falls into the web cookie branch and strands the rider
 * on a web error page in the system browser (loam-logger#267). The prefix
 * survives the round trip in the token itself, so the callback can read it
 * before consuming the row. Web start routes issue bare hex states, which
 * can never carry it.
 *
 * `consumeOAuthAttempt` hashes the token exactly as issued, prefix included,
 * so it needs no knowledge of the prefix.
 */
export const MOBILE_STATE_PREFIX = 'm.';

/** True when the state token was issued by a mobile start route. */
export function isMobileOAuthState(state: string): boolean {
  return state.startsWith(MOBILE_STATE_PREFIX);
}

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

  const random = randomString(32);
  const state = platform === 'MOBILE' ? `${MOBILE_STATE_PREFIX}${random}` : random;
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

  // Atomic claim: only one concurrent caller can set usedAt on a given row
  const updated = await prisma.oAuthAttempt.updateMany({
    where: {
      stateHash,
      provider,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  if (updated.count === 0) {
    return null;
  }

  // Fetch the claimed attempt by its unique stateHash (no timestamp matching needed)
  const attempt = await prisma.oAuthAttempt.findUnique({
    where: { stateHash },
  });

  if (!attempt) {
    return null;
  }

  return { attempt, verifier: attempt.nonce };
}

/**
 * Who started an attempt that can no longer be consumed (expired or already
 * used). For analytics attribution only: the rider is never authenticated
 * from this, and the row may already be gone (see cleanupExpiredAttempts),
 * in which case the event is recorded anonymously.
 */
export async function findOAuthAttemptOwner(params: {
  state: string;
  provider: IntegrationProvider;
}): Promise<string | undefined> {
  const { state, provider } = params;
  const stateHash = await sha256(state);
  const attempt = await prisma.oAuthAttempt.findUnique({
    where: { stateHash },
    select: { userId: true, provider: true },
  });
  return attempt?.provider === provider ? attempt.userId : undefined;
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
