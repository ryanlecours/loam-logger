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
 * Validate an OAuthAttempt by matching state hash.
 * Returns the attempt and its stored verifier (nonce) if valid, or null.
 * Does NOT mark the attempt as used — caller must call markAttemptUsed after successful token exchange.
 */
export async function validateOAuthAttempt(params: {
  state: string;
  provider: IntegrationProvider;
}): Promise<{ attempt: OAuthAttempt; verifier: string } | null> {
  const { state, provider } = params;
  const stateHash = await sha256(state);

  const attempt = await prisma.oAuthAttempt.findFirst({
    where: {
      stateHash,
      provider,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!attempt) {
    return null;
  }

  return { attempt, verifier: attempt.nonce };
}

/**
 * Mark an OAuthAttempt as consumed (single-use enforcement).
 */
export async function markAttemptUsed(attemptId: string): Promise<void> {
  await prisma.oAuthAttempt.update({
    where: { id: attemptId },
    data: { usedAt: new Date() },
  });
}
