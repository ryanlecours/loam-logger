// Mock dependencies BEFORE importing the service
jest.mock('../lib/prisma', () => ({
  prisma: {
    emailSignInGrant: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('./email-verification.service', () => ({
  EMAIL_VERIFICATION_TTL_HOURS: 24,
  isEmailVerificationPending: (u: { emailVerificationRequired: boolean; emailVerified: Date | null }) =>
    u.emailVerificationRequired && !u.emailVerified,
}));

import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import {
  cleanupExpiredSignInGrants,
  createSignInGrant,
  issueSignInGrant,
  MAX_LIVE_SIGN_IN_GRANTS,
  redeemSignInGrant,
} from './email-sign-in-grant.service';

const mockGrant = prisma.emailSignInGrant as unknown as {
  findUnique: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  updateMany: jest.Mock;
  deleteMany: jest.Mock;
};
const mockUserFindUnique = prisma.user.findUnique as unknown as jest.Mock;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  // The callback gets a tx that shares the top-level mocks, so assertions see every write.
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ emailSignInGrant: mockGrant, user: { findUnique: mockUserFindUnique } }),
  );
  mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 4 });
  mockGrant.findMany.mockResolvedValue([]);
  mockGrant.updateMany.mockResolvedValue({ count: 1 });
});

describe('createSignInGrant', () => {
  it('stores only the hash, bound to the client and the current session version, for 24 hours', async () => {
    const before = Date.now();
    const { secret, expiresAt } = await createSignInGrant('user_1', 'mobile');

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const data = mockGrant.create.mock.calls[0][0].data;
    expect(data).toEqual({
      userId: 'user_1',
      secretHash: sha256(secret),
      client: 'mobile',
      sessionTokenVersion: 4,
      expiresAt,
    });
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * HOUR);
  });

  it(`keeps the newest ${MAX_LIVE_SIGN_IN_GRANTS} live grants and retires the rest`, async () => {
    mockGrant.findMany.mockResolvedValue([{ id: 'old_1' }, { id: 'old_2' }]);

    await createSignInGrant('user_1', 'web');

    expect(mockGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user_1', usedAt: null }),
        orderBy: { createdAt: 'desc' },
        skip: MAX_LIVE_SIGN_IN_GRANTS,
      }),
    );
    expect(mockGrant.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old_1', 'old_2'] } },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('retires nothing while the account is under the cap', async () => {
    await createSignInGrant('user_1', 'web');
    expect(mockGrant.updateMany).not.toHaveBeenCalled();
  });

  it('issues a different secret every time', async () => {
    const a = await createSignInGrant('user_1', 'web');
    const b = await createSignInGrant('user_1', 'web');
    expect(a.secret).not.toBe(b.secret);
  });
});

describe('issueSignInGrant', () => {
  it('returns null instead of throwing when the write fails', async () => {
    mockGrant.create.mockRejectedValueOnce(new Error('db down'));
    await expect(issueSignInGrant('user_1', 'web')).resolves.toBeNull();
  });
});

describe('redeemSignInGrant', () => {
  const verifiedUser = {
    id: 'user_1',
    email: 'rider@example.com',
    name: 'Rider',
    avatarUrl: null,
    mustChangePassword: false,
    emailVerificationRequired: true,
    emailVerified: new Date('2026-10-20T10:00:00Z'),
    sessionTokenVersion: 4,
  };

  function grantRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'grant_1',
      client: 'web',
      sessionTokenVersion: 4,
      expiresAt: new Date(Date.now() + HOUR),
      usedAt: null,
      user: verifiedUser,
      ...overrides,
    };
  }

  it('looks the secret up by its hash, never the raw value', async () => {
    mockGrant.findUnique.mockResolvedValue(null);
    await redeemSignInGrant('raw-secret', 'web');
    expect(mockGrant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { secretHash: sha256('raw-secret') } }),
    );
  });

  it('signs in once the email is verified, claiming the grant in the same write that checks it', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow());

    const result = await redeemSignInGrant('raw-secret', 'web');

    expect(result).toEqual({
      ok: true,
      user: { id: 'user_1', email: 'rider@example.com', name: 'Rider', avatarUrl: null, mustChangePassword: false },
    });
    expect(mockGrant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'grant_1',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
        user: { sessionTokenVersion: 4 },
      },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('reports pending, and spends nothing, while the email is unverified', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow({ user: { ...verifiedUser, emailVerified: null } }));

    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'pending' });
    expect(mockGrant.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    mockGrant.findUnique.mockResolvedValue(null);
    await expect(redeemSignInGrant('wrong', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-string', 42],
    ['far too long', 'x'.repeat(500)],
  ])('refuses a %s secret without a lookup', async (_label, secret) => {
    await expect(redeemSignInGrant(secret, 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockGrant.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a grant that already signed in', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow({ usedAt: new Date() }));
    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockGrant.updateMany).not.toHaveBeenCalled();
  });

  it('refuses the loser of two polls racing on one grant', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow());
    mockGrant.updateMany.mockResolvedValue({ count: 0 });
    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses an expired grant, even once the email is verified', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockGrant.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an expired grant that is still pending, so the client stops polling', async () => {
    mockGrant.findUnique.mockResolvedValue(
      grantRow({ expiresAt: new Date(Date.now() - 1000), user: { ...verifiedUser, emailVerified: null } }),
    );
    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a grant after a password reset or session revoke bumped the version', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow({ user: { ...verifiedUser, sessionTokenVersion: 5 } }));
    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockGrant.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a web grant at the mobile exchange and the reverse', async () => {
    mockGrant.findUnique.mockResolvedValue(grantRow({ client: 'web' }));
    await expect(redeemSignInGrant('raw-secret', 'mobile')).resolves.toEqual({ ok: false, reason: 'invalid' });

    mockGrant.findUnique.mockResolvedValue(grantRow({ client: 'mobile' }));
    await expect(redeemSignInGrant('raw-secret', 'web')).resolves.toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('cleanupExpiredSignInGrants', () => {
  it('deletes grants that expired before the cutoff', async () => {
    mockGrant.deleteMany.mockResolvedValue({ count: 3 });
    const before = Date.now();

    await expect(cleanupExpiredSignInGrants(24)).resolves.toBe(3);

    const cutoff: Date = mockGrant.deleteMany.mock.calls[0][0].where.expiresAt.lt;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - 24 * HOUR + 1000);
  });
});
