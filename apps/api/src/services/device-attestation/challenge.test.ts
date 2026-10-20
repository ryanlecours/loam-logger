const store = new Map<string, string>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  getdel: jest.fn(async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return value;
  }),
};
let mockReady = true;

jest.mock('../../lib/redis', () => ({
  getRedisConnection: () => mockRedis,
  isRedisReady: () => mockReady,
}));
jest.mock('../../lib/logger', () => ({ logger: { warn: jest.fn() } }));

import {
  __test,
  consumeAttestationChallenge,
  issueAttestationChallenge,
  CHALLENGE_TTL_SECONDS,
  MAX_MEMORY_CHALLENGES,
} from './challenge';

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  __test.memory.clear();
  mockReady = true;
});

describe('attestation challenges', () => {
  it('issues 32 random bytes as base64url with a TTL in Redis', async () => {
    const challenge = await issueAttestationChallenge();
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockRedis.set).toHaveBeenCalledWith(`attest:challenge:${challenge}`, '1', 'EX', CHALLENGE_TTL_SECONDS);
    expect(await issueAttestationChallenge()).not.toBe(challenge);
  });

  it('consumes a challenge exactly once', async () => {
    const challenge = await issueAttestationChallenge();
    expect(await consumeAttestationChallenge(challenge)).toBe(true);
    expect(await consumeAttestationChallenge(challenge)).toBe(false);
  });

  it('refuses challenges it never issued, without asking Redis about junk', async () => {
    expect(await consumeAttestationChallenge('A'.repeat(43))).toBe(false);
    for (const junk of [undefined, 42, '', 'short', 'A'.repeat(44), 'A'.repeat(42) + '!']) {
      expect(await consumeAttestationChallenge(junk)).toBe(false);
    }
    expect(mockRedis.getdel).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory while Redis is down', async () => {
    mockReady = false;
    const challenge = await issueAttestationChallenge();
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(await consumeAttestationChallenge(challenge)).toBe(true);
    expect(await consumeAttestationChallenge(challenge)).toBe(false);
  });

  it('refuses a Redis-issued challenge while Redis is down, rather than guessing', async () => {
    const challenge = await issueAttestationChallenge();
    mockReady = false;
    // Recorded as failed:challenge_invalid; the app fetches a new one next attempt.
    expect(await consumeAttestationChallenge(challenge)).toBe(false);
    expect(mockRedis.getdel).not.toHaveBeenCalled();

    mockReady = true;
    expect(await consumeAttestationChallenge(challenge)).toBe(true);
  });

  it('caps the memory fallback, dropping the oldest challenge first', async () => {
    mockReady = false;
    const first = await issueAttestationChallenge();
    for (let i = 1; i < MAX_MEMORY_CHALLENGES; i++) __test.memory.set(`filler-${i}`, Date.now() + 60_000);
    const latest = await issueAttestationChallenge();

    expect(__test.memory.size).toBe(MAX_MEMORY_CHALLENGES);
    expect(await consumeAttestationChallenge(first)).toBe(false);
    expect(await consumeAttestationChallenge(latest)).toBe(true);
  });

  it('expires memory challenges after the TTL', async () => {
    mockReady = false;
    jest.useFakeTimers();
    try {
      const challenge = await issueAttestationChallenge();
      jest.advanceTimersByTime(CHALLENGE_TTL_SECONDS * 1000 + 1);
      expect(await consumeAttestationChallenge(challenge)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
