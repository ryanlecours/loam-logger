// Mock Prisma
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindUnique = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock('./prisma', () => ({
  prisma: {
    oAuthAttempt: {
      create: mockCreate,
      updateMany: mockUpdateMany,
      findUnique: mockFindUnique,
      deleteMany: mockDeleteMany,
    },
  },
}));

// Mock pcke (sha256 and randomString)
jest.mock('./pcke', () => ({
  randomString: jest.fn((len: number) => 'r'.repeat(len)),
  sha256: jest.fn(async (input: string) => `hashed_${input}`),
}));

import { createOAuthAttempt, consumeOAuthAttempt, cleanupExpiredAttempts } from './oauthState';

describe('oauthState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOAuthAttempt', () => {
    it('should create an attempt with hashed state and no verifier by default', async () => {
      const fakeAttempt = { id: 'attempt-1', provider: 'GARMIN', userId: 'user-1' };
      mockCreate.mockResolvedValue(fakeAttempt);

      const result = await createOAuthAttempt({
        userId: 'user-1',
        provider: 'GARMIN',
        platform: 'MOBILE',
      });

      expect(result.state).toBe('r'.repeat(32));
      expect(result.verifier).toBe(''); // no PKCE verifier
      expect(result.attempt).toBe(fakeAttempt);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'GARMIN',
          userId: 'user-1',
          platform: 'MOBILE',
          stateHash: `hashed_${'r'.repeat(32)}`,
          nonce: '',
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('should include a PKCE verifier when includeVerifier is true', async () => {
      const fakeAttempt = { id: 'attempt-2' };
      mockCreate.mockResolvedValue(fakeAttempt);

      const result = await createOAuthAttempt({
        userId: 'user-1',
        provider: 'GARMIN',
        platform: 'MOBILE',
        includeVerifier: true,
      });

      expect(result.verifier).toBe('r'.repeat(64));
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nonce: 'r'.repeat(64),
        }),
      });
    });
  });

  describe('consumeOAuthAttempt', () => {
    it('should return attempt and verifier when claim succeeds', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUnique.mockResolvedValue({
        id: 'attempt-1',
        provider: 'GARMIN',
        userId: 'user-1',
        nonce: 'the-verifier',
        stateHash: 'hashed_some-state',
      });

      const result = await consumeOAuthAttempt({
        state: 'some-state',
        provider: 'GARMIN',
      });

      expect(result).not.toBeNull();
      expect(result!.verifier).toBe('the-verifier');
      expect(result!.attempt.id).toBe('attempt-1');

      // Verify the atomic updateMany was called with correct filters
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          stateHash: 'hashed_some-state',
          provider: 'GARMIN',
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('should return null when attempt is expired (updateMany returns count 0)', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const result = await consumeOAuthAttempt({
        state: 'expired-state',
        provider: 'GARMIN',
      });

      expect(result).toBeNull();
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('should return null when attempt is already used (replay)', async () => {
      // The atomic updateMany won't match already-used rows (usedAt: null filter)
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const result = await consumeOAuthAttempt({
        state: 'already-used-state',
        provider: 'GARMIN',
      });

      expect(result).toBeNull();
    });

    it('should return null when second concurrent claim fails (count 0)', async () => {
      // First caller claimed it; second concurrent caller gets count: 0
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const result = await consumeOAuthAttempt({
        state: 'race-state',
        provider: 'GARMIN',
      });

      expect(result).toBeNull();
    });

    it('should return null when provider does not match', async () => {
      // State exists but for STRAVA, not GARMIN
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const result = await consumeOAuthAttempt({
        state: 'some-state',
        provider: 'GARMIN',
      });

      expect(result).toBeNull();
    });

    it('should return null if findUnique returns null after claim', async () => {
      // Edge case: updateMany succeeds but findUnique fails (shouldn't happen, but handled)
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUnique.mockResolvedValue(null);

      const result = await consumeOAuthAttempt({
        state: 'some-state',
        provider: 'GARMIN',
      });

      expect(result).toBeNull();
    });
  });

  describe('cleanupExpiredAttempts', () => {
    it('should delete expired attempts and return count', async () => {
      mockDeleteMany.mockResolvedValue({ count: 5 });

      const count = await cleanupExpiredAttempts();

      expect(count).toBe(5);
      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('should use default 24-hour cutoff', async () => {
      mockDeleteMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      await cleanupExpiredAttempts();

      const call = mockDeleteMany.mock.calls[0][0];
      const cutoff = call.where.expiresAt.lt.getTime();
      const expectedCutoff = before - 24 * 60 * 60 * 1000;
      // Allow 1 second tolerance
      expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(1000);
    });

    it('should respect custom olderThanHours parameter', async () => {
      mockDeleteMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      await cleanupExpiredAttempts(1);

      const call = mockDeleteMany.mock.calls[0][0];
      const cutoff = call.where.expiresAt.lt.getTime();
      const expectedCutoff = before - 1 * 60 * 60 * 1000;
      expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(1000);
    });

    it('should return 0 when no expired attempts exist', async () => {
      mockDeleteMany.mockResolvedValue({ count: 0 });

      const count = await cleanupExpiredAttempts();

      expect(count).toBe(0);
    });
  });
});
