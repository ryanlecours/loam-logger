const mockUserAccountFindUnique = jest.fn();
const mockUserAccountCreate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
const mockOauthTokenCreate = jest.fn();
const mockOauthTokenUpsert = jest.fn();
const mockReferralCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/referral.service', () => ({
  resolveReferrer: jest.fn().mockResolvedValue(null),
  createUserWithReferralCode: jest.fn(async (fn: (code: string) => Promise<unknown>) => fn('abc12345')),
}));

const mockConfig = { bypassWaitlistFlow: false };
jest.mock('../config/env', () => ({
  config: mockConfig,
}));

import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { resolveReferrer } from '../services/referral.service';

function createTx() {
  return {
    userAccount: {
      findUnique: mockUserAccountFindUnique,
      create: mockUserAccountCreate,
    },
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      update: mockUserUpdate,
    },
    oauthToken: {
      create: mockOauthTokenCreate,
      upsert: mockOauthTokenUpsert,
    },
    referral: {
      create: mockReferralCreate,
    },
  };
}

const baseClaims = {
  sub: 'google-123',
  email: 'test@test.com',
  email_verified: true,
  name: 'Test User',
  picture: 'https://example.com/photo.jpg',
};

describe('ensureUserFromGoogle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.bypassWaitlistFlow = false;
  });

  it('should throw CLOSED_BETA for new users when bypass is off', async () => {
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);

    await expect(ensureUserFromGoogle(baseClaims)).rejects.toThrow('CLOSED_BETA');
  });

  it('should create FREE user when bypass is on and user is new', async () => {
    mockConfig.bypassWaitlistFlow = true;
    const createdUser = { id: 'new-user', email: 'test@test.com', role: 'FREE' };
    // Phase 1 returns null (no existing user), Phase 2 creates the user
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(createTx()));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue(createdUser);
    mockUserAccountCreate.mockResolvedValue({});

    const result = await ensureUserFromGoogle(baseClaims);

    expect(result).toEqual(createdUser);
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'test@test.com',
        role: 'FREE',
        subscriptionTier: 'FREE_LIGHT',
        referralCode: 'abc12345',
      }),
    });
    expect(mockUserAccountCreate).toHaveBeenCalledWith({
      data: { userId: 'new-user', provider: 'google', providerUserId: 'google-123' },
    });
  });

  it('should create referral record when ref is provided', async () => {
    mockConfig.bypassWaitlistFlow = true;
    (resolveReferrer as jest.Mock).mockResolvedValue('referrer-id');
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(createTx()));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: 'new-user', email: 'test@test.com' });
    mockUserAccountCreate.mockResolvedValue({});

    await ensureUserFromGoogle(baseClaims, undefined, 'refcode');

    expect(resolveReferrer).toHaveBeenCalledWith('refcode');
    expect(mockReferralCreate).toHaveBeenCalledWith({
      data: { referrerUserId: 'referrer-id', referredUserId: 'new-user' },
    });
  });

  it('should not create referral when ref is not provided', async () => {
    mockConfig.bypassWaitlistFlow = true;
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(createTx()));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: 'new-user', email: 'test@test.com' });
    mockUserAccountCreate.mockResolvedValue({});

    await ensureUserFromGoogle(baseClaims);

    expect(mockReferralCreate).not.toHaveBeenCalled();
  });

  it('should throw ALREADY_ON_WAITLIST for waitlist users', async () => {
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ role: 'WAITLIST' });

    await expect(ensureUserFromGoogle(baseClaims)).rejects.toThrow('ALREADY_ON_WAITLIST');
  });

  it('should return existing user for linked Google account', async () => {
    const existingUser = { id: 'existing', email: 'test@test.com', role: 'FREE' };
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue({ user: existingUser });
    mockUserUpdate.mockResolvedValue(existingUser);

    const result = await ensureUserFromGoogle(baseClaims);

    expect(result).toEqual(existingUser);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });
});
