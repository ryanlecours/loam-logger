jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock('./account-deletion.service', () => ({
  deleteUserAccount: jest.fn(),
}));

jest.mock('./email-verification.service', () => ({
  cleanupExpiredEmailVerificationTokens: jest.fn().mockResolvedValue(0),
  UNVERIFIED_ACCOUNT_TTL_DAYS: 14,
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }),
}));

import { prisma } from '../lib/prisma';
import { deleteUserAccount } from './account-deletion.service';
import { purgeUnverifiedAccounts } from './unverified-account-cleanup.service';

const mockFindMany = prisma.user.findMany as unknown as jest.Mock;
const mockFindFirst = prisma.user.findFirst as unknown as jest.Mock;
const mockDelete = deleteUserAccount as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Each candidate is still unverified when re-checked unless a test says otherwise.
  mockFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
});

describe('purgeUnverifiedAccounts', () => {
  it('selects only gated, unverified accounts older than the window', async () => {
    mockFindMany.mockResolvedValue([]);
    const before = Date.now();

    await purgeUnverifiedAccounts(14);

    const { where } = mockFindMany.mock.calls[0][0];
    expect(where.emailVerificationRequired).toBe(true);
    expect(where.emailVerified).toBeNull();
    const ageMs = before - where.createdAt.lt.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(14 * 24 * 3600 * 1000 - 1000);
    expect(ageMs).toBeLessThanOrEqual(14 * 24 * 3600 * 1000 + 1000);
  });

  it('deletes each through the account deletion service and counts the successes', async () => {
    mockFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    mockDelete
      .mockResolvedValueOnce({ email: 'a@example.com' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ email: 'c@example.com' });

    await expect(purgeUnverifiedAccounts(14)).resolves.toBe(2);
    expect(mockDelete.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
  });
});

describe('purgeUnverifiedAccounts re-check', () => {
  it('skips an account that verified after the batch was read', async () => {
    mockFindMany.mockResolvedValue([{ id: 'a' }, { id: 'verified-meanwhile' }, { id: 'c' }]);
    mockFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'verified-meanwhile' ? null : { id: where.id },
    );
    mockDelete.mockResolvedValue({ email: 'x@example.com' });

    await expect(purgeUnverifiedAccounts(14)).resolves.toBe(2);
    expect(mockDelete.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
    // The re-check applies the same staleness rules, scoped to the one account.
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'verified-meanwhile', emailVerificationRequired: true, emailVerified: null }),
      select: { id: true },
    });
  });
});
