const mockUserAccountFindUnique = jest.fn();
const mockUserAccountCreate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockUserUpdate = jest.fn();
const mockOauthTokenCreate = jest.fn();
const mockOauthTokenUpsert = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockConfig = { bypassWaitlistFlow: false };
jest.mock('../config/env', () => ({
  config: mockConfig,
}));

import { ensureUserFromGoogle } from './ensureUserFromGoogle';

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
});
