const mockUserFindUnique = jest.fn();
const mockUserFindUniqueOrThrow = jest.fn();
const mockUserUpdate = jest.fn();
const mockReferralFindUnique = jest.fn();
const mockReferralFindFirst = jest.fn();
const mockReferralCreate = jest.fn();
const mockReferralUpdate = jest.fn();
const mockReferralUpdateMany = jest.fn();
const mockRideCount = jest.fn().mockResolvedValue(1); // default: referred user has 1 ride
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
      updateMany: jest.fn(),
    },
    referral: {
      findUnique: (...args: unknown[]) => mockReferralFindUnique(...args),
      findFirst: (...args: unknown[]) => mockReferralFindFirst(...args),
      create: (...args: unknown[]) => mockReferralCreate(...args),
      update: (...args: unknown[]) => mockReferralUpdate(...args),
      updateMany: (...args: unknown[]) => mockReferralUpdateMany(...args),
      count: jest.fn().mockResolvedValue(0),
    },
    ride: {
      count: (...args: unknown[]) => mockRideCount(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('./email.service', () => ({
  sendEmailWithAudit: jest.fn().mockResolvedValue({ messageId: 'test', status: 'sent' }),
}));

jest.mock('../templates/emails/referral-success', () => ({
  getReferralSuccessEmailHtml: jest.fn().mockResolvedValue('<html>test</html>'),
  getReferralSuccessEmailSubject: jest.fn().mockReturnValue('Test subject'),
  REFERRAL_SUCCESS_TEMPLATE_VERSION: '1.0.0',
}));

import { completeReferral } from './referral.service';

describe('completeReferral', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should no-op if no referral exists for the user', async () => {
    mockReferralFindUnique.mockResolvedValue(null);

    await completeReferral('user-999');

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should no-op if referral is already COMPLETED', async () => {
    mockReferralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'COMPLETED',
      referrer: { id: 'referrer-1', email: 'r@test.com', name: 'R', subscriptionTier: 'FREE_LIGHT', isFoundingRider: false },
      referred: { name: 'Friend' },
    });

    await completeReferral('user-1');

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should claim the referral and upgrade referrer from FREE_LIGHT to FREE_FULL', async () => {
    mockReferralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      referrer: { id: 'referrer-1', email: 'r@test.com', name: 'Referrer', subscriptionTier: 'FREE_LIGHT', isFoundingRider: false },
      referred: { name: 'Friend' },
    });

    // Interactive transaction: execute the callback
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        referral: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ subscriptionTier: 'FREE_LIGHT', isFoundingRider: false }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    await completeReferral('user-1');

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('should not upgrade referrer if already on FREE_FULL', async () => {
    mockReferralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      referrer: { id: 'referrer-1', email: 'r@test.com', name: 'Referrer', subscriptionTier: 'FREE_FULL', isFoundingRider: false },
      referred: { name: 'Friend' },
    });

    let userUpdateCalled = false;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        referral: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ subscriptionTier: 'FREE_FULL', isFoundingRider: false }),
          update: jest.fn().mockImplementation(() => { userUpdateCalled = true; return Promise.resolve({}); }),
        },
      };
      return fn(tx);
    });

    await completeReferral('user-1');

    expect(userUpdateCalled).toBe(false);
  });

  it('should not upgrade founding riders', async () => {
    mockReferralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      referrer: { id: 'referrer-1', email: 'r@test.com', name: 'Referrer', subscriptionTier: 'FREE_LIGHT', isFoundingRider: true },
      referred: { name: 'Friend' },
    });

    let userUpdateCalled = false;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        referral: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ subscriptionTier: 'FREE_LIGHT', isFoundingRider: true }),
          update: jest.fn().mockImplementation(() => { userUpdateCalled = true; return Promise.resolve({}); }),
        },
      };
      return fn(tx);
    });

    await completeReferral('user-1');

    expect(userUpdateCalled).toBe(false);
  });

  it('should no-op on concurrent claim (count === 0)', async () => {
    mockReferralFindUnique.mockResolvedValue({
      id: 'ref-1',
      status: 'PENDING',
      referrer: { id: 'referrer-1', email: 'r@test.com', name: 'R', subscriptionTier: 'FREE_LIGHT', isFoundingRider: false },
      referred: { name: 'F' },
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        referral: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        user: {
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
      };
      return fn(tx);
    });

    await completeReferral('user-1');

    // Transaction ran but findUniqueOrThrow should NOT have been called (early return)
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('getReferralStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return stats for user with existing referral code', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({ referralCode: 'abc12345' });

    const { getReferralStats } = await import('./referral.service');
    const result = await getReferralStats('user-1');

    expect(result.referralCode).toBe('abc12345');
    expect(result.referralLink).toContain('ref=abc12345');
  });

  it('should backfill referral code when missing', async () => {
    const mockUserUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    // First call: no code. After backfill: has code.
    mockUserFindUniqueOrThrow.mockResolvedValue({ referralCode: null });

    // Mock prisma.user.updateMany for the backfill
    const { prisma } = await import('../lib/prisma');
    (prisma.user as unknown as Record<string, jest.Mock>).updateMany = mockUserUpdateMany;

    const { getReferralStats } = await import('./referral.service');
    const result = await getReferralStats('user-1');

    expect(mockUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1', referralCode: null },
      })
    );
    expect(result.referralCode).toBeTruthy();
  });

  it('should re-read code when concurrent request set it first', async () => {
    const mockUserUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    mockUserFindUniqueOrThrow
      .mockResolvedValueOnce({ referralCode: null }) // initial read
      .mockResolvedValueOnce({ referralCode: 'concurrent_code' }); // re-read after race

    const { prisma } = await import('../lib/prisma');
    (prisma.user as unknown as Record<string, jest.Mock>).updateMany = mockUserUpdateMany;

    const { getReferralStats } = await import('./referral.service');
    const result = await getReferralStats('user-1');

    expect(result.referralCode).toBe('concurrent_code');
  });

  it('should retry on referral code collision (P2002)', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const mockUserUpdateMany = jest.fn()
      .mockRejectedValueOnce(p2002Error) // first attempt collides
      .mockResolvedValueOnce({ count: 1 }); // second attempt succeeds

    mockUserFindUniqueOrThrow.mockResolvedValue({ referralCode: null });

    const { prisma } = await import('../lib/prisma');
    (prisma.user as unknown as Record<string, jest.Mock>).updateMany = mockUserUpdateMany;

    const { getReferralStats } = await import('./referral.service');
    const result = await getReferralStats('user-1');

    expect(mockUserUpdateMany).toHaveBeenCalledTimes(2);
    expect(result.referralCode).toBeTruthy();
  });
});
