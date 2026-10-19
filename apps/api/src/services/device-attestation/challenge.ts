import { randomBytes } from 'crypto';
import { getRedisConnection, isRedisReady } from '../../lib/redis';
import { logger } from '../../lib/logger';

/**
 * One-time attestation challenges. The app fetches one right before signup,
 * folds it into its App Attest or Play Integrity request, and the signup
 * consumes it. A challenge works once and expires after CHALLENGE_TTL_SECONDS,
 * so a captured attestation cannot be replayed.
 *
 * Redis holds them so any API instance can consume what another issued. If
 * Redis is down, an in-memory map keeps a single instance working; a
 * challenge issued there can only be consumed by the same process.
 */

export const CHALLENGE_TTL_SECONDS = 300;
const KEY_PREFIX = 'attest:challenge:';
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const memory = new Map<string, number>();

function pruneMemory(now: number): void {
  for (const [challenge, expiresAt] of memory) {
    if (expiresAt <= now) memory.delete(challenge);
  }
}

export async function issueAttestationChallenge(): Promise<string> {
  const challenge = randomBytes(32).toString('base64url');
  if (isRedisReady()) {
    try {
      await getRedisConnection().set(KEY_PREFIX + challenge, '1', 'EX', CHALLENGE_TTL_SECONDS);
      return challenge;
    } catch (err) {
      logger.warn({ err }, '[Attestation] Redis challenge write failed, using memory');
    }
  }
  const now = Date.now();
  pruneMemory(now);
  memory.set(challenge, now + CHALLENGE_TTL_SECONDS * 1000);
  return challenge;
}

/** True exactly once for a challenge this API issued within the TTL. */
export async function consumeAttestationChallenge(challenge: unknown): Promise<boolean> {
  if (typeof challenge !== 'string' || !CHALLENGE_PATTERN.test(challenge)) return false;

  const expiresAt = memory.get(challenge);
  if (expiresAt !== undefined) {
    memory.delete(challenge);
    return expiresAt > Date.now();
  }

  if (!isRedisReady()) return false;
  try {
    const value = await getRedisConnection().getdel(KEY_PREFIX + challenge);
    return value !== null;
  } catch (err) {
    logger.warn({ err }, '[Attestation] Redis challenge consume failed');
    return false;
  }
}

export const __test = { memory };
