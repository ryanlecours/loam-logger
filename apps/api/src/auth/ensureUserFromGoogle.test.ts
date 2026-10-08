const mockUserAccountFindUnique = jest.fn();
const mockUserAccountCreate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
const mockOauthTokenCreate = jest.fn();
const mockOauthTokenUpsert = jest.fn();
const mockTransaction = jest.fn();
const mockBikeUpdateMany = jest.fn();
const mockComponentShareDeleteMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockConfig = { bypassWaitlistFlow: false };
jest.mock('../config/env', () => ({
  config: mockConfig,
}));

import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { ProviderLinkNeedsPasswordError, UnverifiedProviderEmailError } from './account-linking';

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
    bike: { updateMany: mockBikeUpdateMany },
    componentShare: { deleteMany: mockComponentShareDeleteMany },
    oauthToken: {
      create: mockOauthTokenCreate,
      upsert: mockOauthTokenUpsert,
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

  it('should create FREE user when user is new', async () => {
    const createdUser = { id: 'new-user', email: 'test@test.com', role: 'FREE' };
    // Phase 1 returns null (no existing user), Phase 2 creates the user
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(createTx()));
    mockUserAccountFindUnique.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue(createdUser);
    mockUserAccountCreate.mockResolvedValue({});

    const result = await ensureUserFromGoogle(baseClaims);

    expect(result).toEqual({ user: createdUser, wasCreated: true });
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'test@test.com',
        role: 'FREE',
        subscriptionTier: 'FREE',
      }),
    });
    expect(mockUserAccountCreate).toHaveBeenCalledWith({
      data: { userId: 'new-user', provider: 'google', providerUserId: 'google-123' },
    });
  });

  it('should return existing user for linked Google account', async () => {
    const existingUser = { id: 'existing', email: 'test@test.com', role: 'FREE' };
    const tx = createTx();
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    mockUserAccountFindUnique.mockResolvedValue({ user: existingUser });
    mockUserUpdate.mockResolvedValue(existingUser);

    const result = await ensureUserFromGoogle(baseClaims);

    expect(result).toEqual({ user: existingUser, wasCreated: false });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  describe('linking to an existing account found by email', () => {
    beforeEach(() => {
      mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(createTx()));
      mockUserAccountFindUnique.mockResolvedValue(null);
      mockUserAccountCreate.mockResolvedValue({});
      mockUserUpdate.mockResolvedValue({});
      mockBikeUpdateMany.mockResolvedValue({ count: 0 });
      mockComponentShareDeleteMany.mockResolvedValue({ count: 0 });
    });

    it('refuses to link when the provider has not verified the email', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'victim', email: 'test@test.com', passwordHash: 'hash', emailVerified: null,
      });

      await expect(
        ensureUserFromGoogle({ ...baseClaims, email_verified: false })
      ).rejects.toBeInstanceOf(UnverifiedProviderEmailError);
      expect(mockUserAccountCreate).not.toHaveBeenCalled();
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it('holds the link for the password on an account with an unverified email', async () => {
      // Whoever set this password may not own the address, and nothing on the
      // account says whether it is a squatter or a rider from before email
      // verification. The link waits for the password; nothing is wiped.
      mockUserFindUnique.mockResolvedValue({
        id: 'legacy', email: 'test@test.com', passwordHash: 'hash', emailVerified: null,
      });

      const err = await ensureUserFromGoogle(baseClaims).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ProviderLinkNeedsPasswordError);
      expect(err).toMatchObject({ provider: 'google', userId: 'legacy', email: 'test@test.com' });
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockBikeUpdateMany).not.toHaveBeenCalled();
      expect(mockComponentShareDeleteMany).not.toHaveBeenCalled();
      expect(mockUserAccountCreate).not.toHaveBeenCalled();
    });

    it('keeps the password of an account whose email is already verified', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'owner', email: 'test@test.com', passwordHash: 'hash', emailVerified: new Date(),
      });

      await ensureUserFromGoogle(baseClaims);

      expect(mockUserUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ passwordHash: null }) })
      );
      expect(mockBikeUpdateMany).not.toHaveBeenCalled();
      expect(mockComponentShareDeleteMany).not.toHaveBeenCalled();
      expect(mockUserAccountCreate).toHaveBeenCalled();
    });

    it('links an account with no password without touching sessions', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: 'oauth-only', email: 'test@test.com', passwordHash: null, emailVerified: null,
      });

      await ensureUserFromGoogle(baseClaims);

      expect(mockUserUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sessionTokenVersion: expect.anything() }) })
      );
      expect(mockComponentShareDeleteMany).not.toHaveBeenCalled();
      expect(mockUserAccountCreate).toHaveBeenCalled();
    });
  });
});
