// Mock dependencies BEFORE importing the service
jest.mock('../lib/prisma', () => ({
  prisma: {
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('./email.service', () => ({
  sendReactEmailWithAudit: jest.fn().mockResolvedValue({ messageId: 'mid_1', status: 'sent' }),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../config/env', () => ({
  FRONTEND_URL: 'https://loamlogger.app',
}));

import { prisma } from '../lib/prisma';
import { sendReactEmailWithAudit } from './email.service';
import {
  createPasswordResetToken,
  consumePasswordResetToken,
  sendPasswordResetEmail,
  buildResetUrl,
  PASSWORD_RESET_TTL_MINUTES,
} from './password-reset.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockSendReactEmailWithAudit = sendReactEmailWithAudit as jest.Mock;

// Type-helper to re-expose mock methods on nested Prisma fields with correct typing.
const mockPasswordResetToken = mockPrisma.passwordResetToken as unknown as {
  findUnique: jest.Mock;
  create: jest.Mock;
  updateMany: jest.Mock;
};
const mockTransaction = mockPrisma.$transaction as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildResetUrl', () => {
  it('builds a URL at /reset-password with the token in the query string', () => {
    const url = buildResetUrl('abc123');
    expect(url).toBe('https://loamlogger.app/reset-password?token=abc123');
  });

  it('URL-encodes token characters that need escaping', () => {
    const url = buildResetUrl('a+b/c=d');
    expect(url).toContain('token=a%2Bb%2Fc%3Dd');
  });
});

describe('createPasswordResetToken', () => {
  it('invalidates prior unused tokens and persists a new one in a single transaction', async () => {
    // Capture what the service passes to $transaction
    mockTransaction.mockResolvedValue([{ count: 0 }, { id: 'tok_1' }]);

    const rawToken = await createPasswordResetToken('user_1');

    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBeGreaterThan(20);
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // Extract the two prisma ops that were queued inside the transaction
    const ops = mockTransaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(2);
  });

  it('generates a fresh raw token on each call (cryptographic randomness)', async () => {
    mockTransaction.mockResolvedValue([{ count: 0 }, { id: 'tok' }]);

    const tokens = await Promise.all([
      createPasswordResetToken('user_1'),
      createPasswordResetToken('user_1'),
      createPasswordResetToken('user_1'),
    ]);

    expect(new Set(tokens).size).toBe(3);
  });

  it('stores only a SHA-256 hash (never the raw token) in the DB payload', async () => {
    // Spy on the actual ops by capturing them through the transaction's second arg.
    const createSpy = mockPasswordResetToken.create;
    const updateManySpy = mockPasswordResetToken.updateMany;
    createSpy.mockReturnValue({ __op: 'create' });
    updateManySpy.mockReturnValue({ __op: 'updateMany' });
    mockTransaction.mockResolvedValue([{ count: 0 }, { id: 'tok' }]);

    const rawToken = await createPasswordResetToken('user_1');

    const createCall = createSpy.mock.calls[0][0];
    expect(createCall.data.userId).toBe('user_1');
    expect(createCall.data.tokenHash).toBeDefined();
    // The hash must not equal the raw token
    expect(createCall.data.tokenHash).not.toBe(rawToken);
    // SHA-256 hex string is 64 chars
    expect(createCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets expiresAt to now + TTL', async () => {
    const createSpy = mockPasswordResetToken.create;
    createSpy.mockReturnValue({ __op: 'create' });
    mockPasswordResetToken.updateMany.mockReturnValue({ __op: 'updateMany' });
    mockTransaction.mockResolvedValue([{ count: 0 }, { id: 'tok' }]);

    const before = Date.now();
    await createPasswordResetToken('user_1');
    const after = Date.now();

    const createCall = createSpy.mock.calls[0][0];
    const expiresAt = (createCall.data.expiresAt as Date).getTime();
    const ttlMs = PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + ttlMs - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + ttlMs + 1000);
  });
});

describe('consumePasswordResetToken', () => {
  it('returns { ok: true, userId } on first successful consumption', async () => {
    mockPasswordResetToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    mockPasswordResetToken.updateMany.mockResolvedValue({ count: 1 });

    const result = await consumePasswordResetToken('raw-token');

    expect(result).toEqual({ ok: true, userId: 'user_1' });
    expect(mockPasswordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok_1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('returns { ok: false, reason: "not_found" } when the token does not exist', async () => {
    mockPasswordResetToken.findUnique.mockResolvedValue(null);

    const result = await consumePasswordResetToken('raw-token');

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(mockPasswordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('returns { ok: false, reason: "already_used", userId } when the token was previously consumed', async () => {
    mockPasswordResetToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: 'user_42',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(Date.now() - 10_000),
      createdAt: new Date(),
    });

    const result = await consumePasswordResetToken('raw-token');

    expect(result).toEqual({ ok: false, reason: 'already_used', userId: 'user_42' });
    expect(mockPasswordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('returns { ok: false, reason: "expired" } when the token is past its expiry', async () => {
    mockPasswordResetToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() - 1),
      usedAt: null,
      createdAt: new Date(),
    });

    const result = await consumePasswordResetToken('raw-token');

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(mockPasswordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('returns { ok: false, reason: "already_used", userId } when the atomic update loses the race (count=0)', async () => {
    // Both reads see usedAt: null, but only one updateMany wins.
    mockPasswordResetToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: 'user_7',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });
    // This call loses the race — count is 0.
    mockPasswordResetToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await consumePasswordResetToken('raw-token');

    expect(result).toEqual({ ok: false, reason: 'already_used', userId: 'user_7' });
  });

  it('prevents double-consumption under concurrent calls (only one succeeds)', async () => {
    // Both concurrent calls see the same unused record
    mockPasswordResetToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: 'user_1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    });

    // Simulate a DB race: the first updateMany returns count=1, the second returns count=0.
    let winnerAcknowledged = false;
    mockPasswordResetToken.updateMany.mockImplementation(async () => {
      if (!winnerAcknowledged) {
        winnerAcknowledged = true;
        return { count: 1 };
      }
      return { count: 0 };
    });

    const [a, b] = await Promise.all([
      consumePasswordResetToken('raw-token'),
      consumePasswordResetToken('raw-token'),
    ]);

    const outcomes = [a, b];
    const successes = outcomes.filter((r) => r.ok);
    const failures = outcomes.filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ok: false, reason: 'already_used', userId: 'user_1' });
  });

  it('hashes the raw token before lookup (does not query by raw token)', async () => {
    mockPasswordResetToken.findUnique.mockResolvedValue(null);

    await consumePasswordResetToken('raw-token-xyz');

    const call = mockPasswordResetToken.findUnique.mock.calls[0][0];
    expect(call.where.tokenHash).not.toBe('raw-token-xyz');
    expect(call.where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sendPasswordResetEmail', () => {
  it('emails the user with the reset URL via sendReactEmailWithAudit (bypassing unsubscribe)', async () => {
    await sendPasswordResetEmail(
      { id: 'user_1', email: 'rider@example.com', name: 'Alex Example' },
      'raw-token',
      'admin_password_reset',
    );

    expect(mockSendReactEmailWithAudit).toHaveBeenCalledTimes(1);
    const arg = mockSendReactEmailWithAudit.mock.calls[0][0];
    expect(arg.to).toBe('rider@example.com');
    expect(arg.userId).toBe('user_1');
    expect(arg.emailType).toBe('password_reset');
    expect(arg.triggerSource).toBe('admin_password_reset');
    expect(arg.bypassUnsubscribe).toBe(true);
    expect(arg.subject).toMatch(/reset/i);
    // Make sure the template version is propagated
    expect(arg.templateVersion).toBeDefined();
  });

  it('forwards the user_action trigger source for self-service resets', async () => {
    await sendPasswordResetEmail(
      { id: 'user_1', email: 'a@b.com' },
      'tok',
      'user_action',
    );

    expect(mockSendReactEmailWithAudit.mock.calls[0][0].triggerSource).toBe('user_action');
  });
});
