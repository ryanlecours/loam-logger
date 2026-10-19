// Mock dependencies BEFORE importing the service
jest.mock('../lib/prisma', () => ({
  prisma: {
    emailVerificationToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('./email.service', () => ({
  sendReactEmailWithAudit: jest.fn().mockResolvedValue({ messageId: 'mid_1', status: 'sent' }),
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../config/env', () => ({
  FRONTEND_URL: 'https://loamlogger.app',
}));

import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendReactEmailWithAudit } from './email.service';
import { checkAuthRateLimit } from '../lib/rate-limit';
import {
  buildVerifyUrl,
  cleanupExpiredEmailVerificationTokens,
  consumeEmailVerificationToken,
  createEmailVerificationToken,
  EMAIL_VERIFICATION_TTL_HOURS,
  isEmailVerificationPending,
  sendVerificationEmailWithinLimit,
} from './email-verification.service';

const mockToken = prisma.emailVerificationToken as unknown as {
  findUnique: jest.Mock;
  create: jest.Mock;
  updateMany: jest.Mock;
  deleteMany: jest.Mock;
};
const mockUserUpdateMany = prisma.user.updateMany as unknown as jest.Mock;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockSendEmail = sendReactEmailWithAudit as jest.Mock;
const mockCheckAuthRateLimit = checkAuthRateLimit as jest.Mock;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  jest.clearAllMocks();
  // Array form runs the queued operations; callback form gets a tx that
  // shares the top-level mocks so assertions see every write.
  mockTransaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)({
          emailVerificationToken: mockToken,
          user: { updateMany: mockUserUpdateMany },
        })
      : Promise.all(arg as Promise<unknown>[]),
  );
  mockCheckAuthRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
});

describe('isEmailVerificationPending', () => {
  it('gates only new signups that have not verified', () => {
    expect(isEmailVerificationPending({ emailVerificationRequired: true, emailVerified: null })).toBe(true);
    expect(isEmailVerificationPending({ emailVerificationRequired: true, emailVerified: new Date() })).toBe(false);
  });

  it('never gates accounts created before verification shipped', () => {
    expect(isEmailVerificationPending({ emailVerificationRequired: false, emailVerified: null })).toBe(false);
  });
});

describe('buildVerifyUrl', () => {
  it('points at the web verify page with the token in the query string', () => {
    expect(buildVerifyUrl('abc123')).toBe('https://loamlogger.app/verify-email?token=abc123');
  });
});

describe('createEmailVerificationToken', () => {
  it('stores only the hash, expires in 24 hours, and invalidates older unused tokens', async () => {
    const before = Date.now();
    const raw = await createEmailVerificationToken('user_1');

    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    const created = mockToken.create.mock.calls[0][0].data;
    expect(created.userId).toBe('user_1');
    expect(created.tokenHash).toBe(sha256(raw));
    expect(created.tokenHash).not.toBe(raw);
    const ttlMs = created.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(EMAIL_VERIFICATION_TTL_HOURS * 3600 * 1000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(EMAIL_VERIFICATION_TTL_HOURS * 3600 * 1000 + 1000);
  });
});

describe('consumeEmailVerificationToken', () => {
  const future = () => new Date(Date.now() + 60_000);

  it('looks the token up by its hash, never the raw value', async () => {
    mockToken.findUnique.mockResolvedValue(null);
    await consumeEmailVerificationToken('raw-token');
    expect(mockToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('raw-token') } });
  });

  it('returns not_found for an unknown token', async () => {
    mockToken.findUnique.mockResolvedValue(null);
    await expect(consumeEmailVerificationToken('nope')).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it('returns expired for a token past its expiry and verifies nothing', async () => {
    mockToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'user_1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(consumeEmailVerificationToken('old')).resolves.toEqual({ ok: false, reason: 'expired' });
    expect(mockToken.updateMany).not.toHaveBeenCalled();
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a second use of the same token', async () => {
    mockToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'user_1',
      usedAt: new Date(),
      expiresAt: future(),
    });
    await expect(consumeEmailVerificationToken('used')).resolves.toEqual({
      ok: false,
      reason: 'already_used',
      userId: 'user_1',
    });
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it('marks the token used and the email verified on success', async () => {
    mockToken.findUnique.mockResolvedValue({ id: 't1', userId: 'user_1', usedAt: null, expiresAt: future() });
    mockToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(consumeEmailVerificationToken('good')).resolves.toEqual({ ok: true, userId: 'user_1' });

    // The write re-checks unused and unexpired, so a concurrent consumer loses.
    expect(mockToken.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    // Only fills emailVerified when it is empty, so a re-verify keeps the original time.
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', emailVerified: null },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it('reports already_used when a concurrent request consumed the token first', async () => {
    mockToken.findUnique
      .mockResolvedValueOnce({ id: 't1', userId: 'user_1', usedAt: null, expiresAt: future() })
      .mockResolvedValueOnce({ usedAt: new Date() });
    mockToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(consumeEmailVerificationToken('raced')).resolves.toEqual({
      ok: false,
      reason: 'already_used',
      userId: 'user_1',
    });
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it('reports expired when the token expired between the read and the write', async () => {
    mockToken.findUnique
      .mockResolvedValueOnce({ id: 't1', userId: 'user_1', usedAt: null, expiresAt: future() })
      .mockResolvedValueOnce({ usedAt: null });
    mockToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(consumeEmailVerificationToken('edge')).resolves.toEqual({ ok: false, reason: 'expired' });
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });
});

describe('sendVerificationEmailWithinLimit', () => {
  const user = { id: 'user_1', email: 'rider@example.com', name: 'Alex Rider' };

  it('sends a link to the web verify page, keyed on a hash of the address for the limit', async () => {
    await expect(sendVerificationEmailWithinLimit(user, 'user_action')).resolves.toBe(true);

    const [operation, key] = mockCheckAuthRateLimit.mock.calls[0];
    expect(operation).toBe('verification-email');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('rider');

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rider@example.com',
        emailType: 'email_verification',
        triggerSource: 'user_action',
        bypassUnsubscribe: true,
      }),
    );
  });

  it('sends nothing once the per-account limit is reached', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 1200, redisAvailable: true });

    await expect(sendVerificationEmailWithinLimit(user, 'user_action')).resolves.toBe(false);
    expect(mockToken.create).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('swallows a failed send so signup and sign-in still answer', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('resend down'));
    await expect(sendVerificationEmailWithinLimit(user, 'user_action')).resolves.toBe(true);
  });
});

describe('cleanupExpiredEmailVerificationTokens', () => {
  it('deletes tokens that expired before the cutoff', async () => {
    mockToken.deleteMany.mockResolvedValue({ count: 4 });
    const before = Date.now();

    await expect(cleanupExpiredEmailVerificationTokens(24)).resolves.toBe(4);

    const cutoff = mockToken.deleteMany.mock.calls[0][0].where.expiresAt.lt.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
  });
});
