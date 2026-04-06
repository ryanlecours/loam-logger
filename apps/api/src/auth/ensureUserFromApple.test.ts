const mockUserAccountFindUnique = jest.fn();
const mockUserAccountCreate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
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

import { ensureUserFromApple } from './ensureUserFromApple';
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
    referral: {
      create: mockReferralCreate,
    },
  };
}

const baseClaims = {
  sub: 'apple-001.abc123',
  email: 'test@test.com',
  email_verified: true,
  name: 'Test User',
};

describe('ensureUserFromApple', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.bypassWaitlistFlow = false;
  });

  it('should throw CLOSED_BETA for new users when bypass is off', async () => {
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);

    await expect(ensureUserFromApple(baseClaims)).rejects.toThrow('CLOSED_BETA');
  });

  it('should create FREE user when bypass is on and user is new', async () => {
    mockConfig.bypassWaitlistFlow = true;
    const createdUser = { id: 'new-user', email: 'test@test.com', role: 'FREE' };
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(createTx()));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue(createdUser);
    mockUserAccountCreate.mockResolvedValue({});

    const result = await ensureUserFromApple(baseClaims);

    expect(result).toEqual(createdUser);
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'test@test.com',
        role: 'FREE',
        subscriptionTier: 'FREE_LIGHT',
        referralCode: 'abc12345',
        avatarUrl: null,
      }),
    });
    expect(mockUserAccountCreate).toHaveBeenCalledWith({
      data: { userId: 'new-user', provider: 'apple', providerUserId: 'apple-001.abc123' },
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

    await ensureUserFromApple(baseClaims, 'refcode');

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

    await ensureUserFromApple(baseClaims);

    expect(mockReferralCreate).not.toHaveBeenCalled();
  });

  it('should throw ALREADY_ON_WAITLIST for waitlist users found by sub', async () => {
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue({ user: { id: 'wl-user', role: 'WAITLIST' } });

    await expect(ensureUserFromApple(baseClaims)).rejects.toThrow('ALREADY_ON_WAITLIST');
  });

  it('should throw ALREADY_ON_WAITLIST for waitlist users found by email', async () => {
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ role: 'WAITLIST' });

    await expect(ensureUserFromApple(baseClaims)).rejects.toThrow('ALREADY_ON_WAITLIST');
  });

  it('should return existing user for linked Apple account', async () => {
    const existingUser = { id: 'existing', email: 'test@test.com', role: 'FREE', name: 'Existing User' };
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue({ user: existingUser });

    const result = await ensureUserFromApple(baseClaims);

    expect(result).toEqual(existingUser);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it('should link Apple account to existing user found by email', async () => {
    const existingUser = { id: 'email-user', email: 'test@test.com', role: 'FREE', name: 'Email User' };
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(existingUser);
    mockUserUpdate.mockResolvedValue(existingUser);
    mockUserAccountCreate.mockResolvedValue({});

    const result = await ensureUserFromApple(baseClaims);

    expect(result).toEqual(existingUser);
    expect(mockUserAccountCreate).toHaveBeenCalledWith({
      data: { userId: 'email-user', provider: 'apple', providerUserId: 'apple-001.abc123' },
    });
  });

  it('should update name for existing linked user with no name and return updated user', async () => {
    const existingUser = { id: 'nameless', email: 'test@test.com', role: 'FREE', name: null };
    const updatedUser = { ...existingUser, name: 'Test User' };
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue({ user: existingUser });
    mockUserUpdate.mockResolvedValue(updatedUser);

    const result = await ensureUserFromApple(baseClaims);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'nameless' },
      data: { name: 'Test User' },
    });
    expect(result.name).toBe('Test User');
  });

  it('should throw when no email and no existing account', async () => {
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockConfig.bypassWaitlistFlow = true;

    const claimsNoEmail = { sub: 'apple-001.abc123', name: 'Test' };
    await expect(ensureUserFromApple(claimsNoEmail)).rejects.toThrow('Apple login did not provide an email');
  });
});
