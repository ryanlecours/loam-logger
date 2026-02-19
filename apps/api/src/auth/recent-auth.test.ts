import { checkRecentAuth, updateLastAuthAt, RECENT_AUTH_WINDOW_MS } from './recent-auth';
import { prisma } from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('checkRecentAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return valid when auth is within 10-minute window', async () => {
    const recentAuthTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: recentAuthTime,
    });

    const result = await checkRecentAuth('user-123');

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.lastAuthAt).toEqual(recentAuthTime);
    }
  });

  it('should return invalid with AUTH_EXPIRED when auth is older than 10 minutes', async () => {
    const oldAuthTime = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: oldAuthTime,
    });

    const result = await checkRecentAuth('user-123');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('AUTH_EXPIRED');
      expect(result.lastAuthAt).toEqual(oldAuthTime);
    }
  });

  it('should return invalid with NEVER_AUTHENTICATED when lastAuthAt is null', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: null,
    });

    const result = await checkRecentAuth('user-123');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('NEVER_AUTHENTICATED');
      expect(result.lastAuthAt).toBeNull();
    }
  });

  it('should return invalid with NEVER_AUTHENTICATED when user not found', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await checkRecentAuth('nonexistent-user');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('NEVER_AUTHENTICATED');
      expect(result.lastAuthAt).toBeNull();
    }
  });

  it('should return valid when auth is exactly at the boundary (just under 10 min)', async () => {
    // Just under 10 minutes - should still be valid
    const boundaryTime = new Date(Date.now() - RECENT_AUTH_WINDOW_MS + 1000);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: boundaryTime,
    });

    const result = await checkRecentAuth('user-123');

    expect(result.valid).toBe(true);
  });

  it('should return invalid when auth is exactly at the boundary (just over 10 min)', async () => {
    // Just over 10 minutes - should be invalid
    const boundaryTime = new Date(Date.now() - RECENT_AUTH_WINDOW_MS - 1000);
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: boundaryTime,
    });

    const result = await checkRecentAuth('user-123');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('AUTH_EXPIRED');
    }
  });

  // Session authAt fallback tests
  it('should use sessionAuthAt as fallback when DB lastAuthAt is null', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: null,
    });

    const recentSessionAuth = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const result = await checkRecentAuth('user-123', recentSessionAuth);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.lastAuthAt?.getTime()).toBe(recentSessionAuth);
    }
  });

  it('should use sessionAuthAt as fallback when user not found', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const recentSessionAuth = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const result = await checkRecentAuth('user-123', recentSessionAuth);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.lastAuthAt?.getTime()).toBe(recentSessionAuth);
    }
  });

  it('should return AUTH_EXPIRED when sessionAuthAt fallback is too old', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: null,
    });

    const oldSessionAuth = Date.now() - 15 * 60 * 1000; // 15 minutes ago
    const result = await checkRecentAuth('user-123', oldSessionAuth);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('AUTH_EXPIRED');
      expect(result.lastAuthAt?.getTime()).toBe(oldSessionAuth);
    }
  });

  it('should prefer DB lastAuthAt over sessionAuthAt when both exist', async () => {
    const dbAuthTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago (DB)
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      lastAuthAt: dbAuthTime,
    });

    const sessionAuthTime = Date.now() - 2 * 60 * 1000; // 2 minutes ago (session)
    const result = await checkRecentAuth('user-123', sessionAuthTime);

    expect(result.valid).toBe(true);
    if (result.valid) {
      // Should use DB time, not session time
      expect(result.lastAuthAt).toEqual(dbAuthTime);
    }
  });
});

describe('updateLastAuthAt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update lastAuthAt timestamp for user', async () => {
    const beforeUpdate = Date.now();
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

    await updateLastAuthAt('user-123');

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-123' },
      data: { lastAuthAt: expect.any(Date) },
    });

    // Verify the timestamp is recent (within a second of when we called it)
    const callArg = (mockPrisma.user.update as jest.Mock).mock.calls[0][0];
    const updatedTime = callArg.data.lastAuthAt.getTime();
    expect(updatedTime).toBeGreaterThanOrEqual(beforeUpdate);
    expect(updatedTime).toBeLessThanOrEqual(Date.now());
  });

  it('should propagate errors from prisma', async () => {
    (mockPrisma.user.update as jest.Mock).mockRejectedValue(new Error('Database error'));

    await expect(updateLastAuthAt('user-123')).rejects.toThrow('Database error');
  });
});
