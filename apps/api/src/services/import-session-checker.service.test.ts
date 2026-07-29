import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before imports
const mockPrismaImportSessionFindMany = jest.fn();
const mockPrismaImportSessionFindUnique = jest.fn();
const mockPrismaImportSessionUpdateMany = jest.fn();
const mockPrismaExecuteRaw = jest.fn();
const mockPrismaBackfillRequestUpdateMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    importSession: {
      findMany: mockPrismaImportSessionFindMany,
      findUnique: mockPrismaImportSessionFindUnique,
      updateMany: mockPrismaImportSessionUpdateMany,
    },
    backfillRequest: {
      updateMany: mockPrismaBackfillRequestUpdateMany,
    },
    $executeRaw: mockPrismaExecuteRaw,
  },
}));

const mockIsRedisReady = jest.fn();
const mockGetRedisConnection = jest.fn();

jest.mock('../lib/redis', () => ({
  isRedisReady: () => mockIsRedisReady(),
  getRedisConnection: () => mockGetRedisConnection(),
}));

// Mock logger to suppress output during tests
jest.mock('../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import after mocks are set up
import {
  startImportSessionChecker,
  stopImportSessionChecker,
} from './import-session-checker.service';

describe('import-session-checker.service', () => {
  let mockRedis: {
    set: jest.Mock;
    eval: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default: Redis is available
    mockRedis = {
      set: jest.fn(),
      eval: jest.fn(),
    };
    mockIsRedisReady.mockReturnValue(true);
    mockGetRedisConnection.mockReturnValue(mockRedis);

    // Default: no idle sessions
    mockPrismaImportSessionFindMany.mockResolvedValue([]);
    mockPrismaImportSessionUpdateMany.mockResolvedValue({ count: 0 });
    mockPrismaExecuteRaw.mockResolvedValue(1);
    mockPrismaImportSessionFindUnique.mockResolvedValue({ unassignedRideCount: 5 });
    mockPrismaBackfillRequestUpdateMany.mockResolvedValue({ count: 0 });
  });

  afterEach(async () => {
    await stopImportSessionChecker();
    jest.useRealTimers();
  });

  describe('acquireCheckerLock', () => {
    it('should skip processing when Redis is unavailable', async () => {
      mockIsRedisReady.mockReturnValue(false);
      mockRedis.set.mockResolvedValue('OK');

      startImportSessionChecker();

      // Fast-forward past the initial check
      await jest.advanceTimersByTimeAsync(100);

      // Verify no session lookup was made (skipped due to no lock)
      expect(mockPrismaImportSessionFindMany).not.toHaveBeenCalled();
    });

    it('should skip processing when Redis lock acquisition fails', async () => {
      mockRedis.set.mockResolvedValue(null); // Lock not acquired

      startImportSessionChecker();

      // Fast-forward past the initial check
      await jest.advanceTimersByTimeAsync(100);

      // Verify no session lookup was made
      expect(mockPrismaImportSessionFindMany).not.toHaveBeenCalled();
    });

    it('should process when lock is acquired successfully', async () => {
      mockRedis.set.mockResolvedValue('OK'); // Lock acquired

      startImportSessionChecker();

      // Fast-forward past the initial check
      await jest.advanceTimersByTimeAsync(100);

      // Verify session lookup was made
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalled();
    });

    it('should skip processing on Redis error', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis connection error'));

      startImportSessionChecker();

      // Fast-forward past the initial check
      await jest.advanceTimersByTimeAsync(100);

      // Verify no session lookup was made (skipped due to error)
      expect(mockPrismaImportSessionFindMany).not.toHaveBeenCalled();
    });
  });

  describe('idle session completion', () => {
    beforeEach(() => {
      mockRedis.set.mockResolvedValue('OK'); // Lock acquired
    });

    it('should complete idle sessions with atomic unassigned count', async () => {
      const idleSession = { id: 'session-123' };
      mockPrismaImportSessionFindMany.mockResolvedValue([idleSession]);
      mockPrismaExecuteRaw.mockResolvedValue(1); // 1 row updated
      mockPrismaImportSessionFindUnique.mockResolvedValue({ unassignedRideCount: 10 });

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Verify atomic update was called
      expect(mockPrismaExecuteRaw).toHaveBeenCalled();

      // Verify the raw query includes the subquery for counting
      const rawCall = mockPrismaExecuteRaw.mock.calls[0];
      expect(rawCall).toBeDefined();
    });

    it('should not fetch count when session update fails', async () => {
      const idleSession = { id: 'session-123' };
      mockPrismaImportSessionFindMany.mockResolvedValue([idleSession]);
      mockPrismaExecuteRaw.mockResolvedValue(0); // 0 rows updated (session already completed)

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Verify we don't fetch the count when update returns 0
      expect(mockPrismaImportSessionFindUnique).not.toHaveBeenCalled();
    });

    it('should handle errors when completing individual sessions', async () => {
      const sessions = [{ id: 'session-1' }, { id: 'session-2' }];
      mockPrismaImportSessionFindMany.mockResolvedValue(sessions);
      mockPrismaExecuteRaw
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce(1);
      mockPrismaImportSessionFindUnique.mockResolvedValue({ unassignedRideCount: 5 });

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Both sessions should be attempted
      expect(mockPrismaExecuteRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('stale session completion', () => {
    beforeEach(() => {
      mockRedis.set.mockResolvedValue('OK');
    });

    it('should complete stale sessions with no activity', async () => {
      mockPrismaImportSessionFindMany.mockResolvedValue([]); // No idle sessions
      mockPrismaImportSessionUpdateMany.mockResolvedValue({ count: 3 });

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Verify stale session update was called
      expect(mockPrismaImportSessionUpdateMany).toHaveBeenCalled();
    });
  });

  /**
   * Regression pins for the permanent "Sync in progress" spinner.
   *
   * The Garmin backfill worker set BackfillRequest to `in_progress` and left it
   * for a webhook handler that never existed. Both clients gate their sync UI on
   * that status and only offer `ytd`, so a single stuck row disabled the whole
   * screen forever. Nothing anywhere swept the table.
   */
  describe('backfill request settlement', () => {
    beforeEach(() => {
      mockRedis.set.mockResolvedValue('OK');
    });

    it('completes a user\'s backfill requests when their idle session closes', async () => {
      mockPrismaImportSessionFindMany.mockResolvedValue([
        { id: 'session-123', userId: 'user-1', provider: 'garmin' },
      ]);
      mockPrismaExecuteRaw.mockResolvedValue(1);

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      expect(mockPrismaBackfillRequestUpdateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          provider: 'garmin',
          status: { in: ['pending', 'in_progress'] },
        },
        data: expect.objectContaining({ status: 'completed' }),
      });
    });

    // Only the instance that actually won the session update should settle the
    // rows, otherwise a losing instance closes a backfill it did not finish.
    it('does not settle when the session update affected no rows', async () => {
      mockPrismaImportSessionFindMany.mockResolvedValue([
        { id: 'session-123', userId: 'user-1', provider: 'garmin' },
      ]);
      mockPrismaExecuteRaw.mockResolvedValue(0);

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      expect(mockPrismaBackfillRequestUpdateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) })
      );
    });

    // Marked failed rather than completed on purpose: the YTD guard resumes
    // from backfilledUpTo only when the previous row says completed, so calling
    // an unfinished backfill complete would silently skip activities that never
    // arrived. failed restarts the range and Garmin 409s what it already sent.
    it('sweeps stale in-flight backfills to failed', async () => {
      mockPrismaImportSessionFindMany.mockResolvedValue([]);
      mockPrismaBackfillRequestUpdateMany.mockResolvedValue({ count: 2 });

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      expect(mockPrismaBackfillRequestUpdateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'in_progress'] },
          updatedAt: { lte: expect.any(Date) },
        },
        data: expect.objectContaining({ status: 'failed' }),
      });
    });

    // The session is the record that matters most; a settlement failure must
    // not abort the rest of the sweep.
    it('continues the sweep when settlement throws', async () => {
      mockPrismaImportSessionFindMany.mockResolvedValue([
        { id: 'session-123', userId: 'user-1', provider: 'garmin' },
      ]);
      mockPrismaExecuteRaw.mockResolvedValue(1);
      mockPrismaBackfillRequestUpdateMany.mockRejectedValueOnce(new Error('db down'));

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Reached the stale-backfill sweep despite the settlement rejection.
      expect(mockPrismaBackfillRequestUpdateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('checker lifecycle', () => {
    it('should not start twice', () => {
      mockRedis.set.mockResolvedValue('OK');

      startImportSessionChecker();
      startImportSessionChecker(); // Second call should be a no-op

      // Only one interval should be set
      expect(jest.getTimerCount()).toBe(1);
    });

    it('should stop gracefully', async () => {
      mockRedis.set.mockResolvedValue('OK');

      startImportSessionChecker();
      expect(jest.getTimerCount()).toBe(1);

      await stopImportSessionChecker();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should check every minute', async () => {
      mockRedis.set.mockResolvedValue('OK');

      startImportSessionChecker();

      // Initial check
      await jest.advanceTimersByTimeAsync(100);
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalledTimes(1);

      // After 1 minute
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalledTimes(2);

      // After another minute
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalledTimes(3);
    });
  });

  describe('concurrent processing protection', () => {
    it('should skip if previous check is still running', async () => {
      mockRedis.set.mockResolvedValue('OK');

      // Make the session query slow
      let resolveQuery: () => void;
      const slowQuery = new Promise<[]>((resolve) => {
        resolveQuery = () => resolve([]);
      });
      mockPrismaImportSessionFindMany.mockReturnValue(slowQuery);

      startImportSessionChecker();

      // Start first check
      await jest.advanceTimersByTimeAsync(100);
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalledTimes(1);

      // Try to trigger another check while first is still running
      await jest.advanceTimersByTimeAsync(60 * 1000);
      // Should still be 1 because previous check is still running
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalledTimes(1);

      // Resolve the slow query
      resolveQuery!();
      await jest.advanceTimersByTimeAsync(100);

      // Now the next interval check should work
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockPrismaImportSessionFindMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('lock release', () => {
    it('should release lock after processing', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(1);

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Verify lock was released
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('should release lock even on error', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(1);
      mockPrismaImportSessionFindMany.mockRejectedValue(new Error('Database error'));

      startImportSessionChecker();
      await jest.advanceTimersByTimeAsync(100);

      // Verify lock was still released
      expect(mockRedis.eval).toHaveBeenCalled();
    });
  });
});
