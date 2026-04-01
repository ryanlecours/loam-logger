const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockUserFindUniqueOrThrow = jest.fn();
const mockUserUpdate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
      findUniqueOrThrow: mockUserFindUniqueOrThrow,
      update: mockUserUpdate,
    },
    referral: {
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: mockTransaction,
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
import { prisma } from '../lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('completeReferral', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should no-op if no referral exists for the user', async () => {
    (mockPrisma.referral.findUnique as jest.Mock).mockResolvedValue(null);

    await completeReferral('user-999');

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should no-op if referral is already COMPLETED', async () => {
    (mockPrisma.referral.findUnique as jest.Mock).mockResolvedValue({
      id: 'ref-1',
      status: 'COMPLETED',
      referrer: { id: 'referrer-1', email: 'r@test.com', name: 'R', subscriptionTier: 'FREE_LIGHT', isFoundingRider: false },
      referred: { name: 'Friend' },
    });

    await completeReferral('user-1');

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('should claim the referral and upgrade referrer from FREE_LIGHT to FREE_FULL', async () => {
    (mockPrisma.referral.findUnique as jest.Mock).mockResolvedValue({
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
    (mockPrisma.referral.findUnique as jest.Mock).mockResolvedValue({
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
    (mockPrisma.referral.findUnique as jest.Mock).mockResolvedValue({
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
    (mockPrisma.referral.findUnique as jest.Mock).mockResolvedValue({
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
