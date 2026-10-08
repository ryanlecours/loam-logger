// Mock dependencies BEFORE importing the service
jest.mock('../lib/prisma', () => {
  const prisma = {
    emailVerificationToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    // Array form resolves the queued operations; callback form runs with the
    // same mock as the transaction client.
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => unknown)(prisma)
  );
  return { prisma };
});

jest.mock('./email.service', () => ({
  sendReactEmailWithAudit: jest.fn().mockResolvedValue({ messageId: 'mid_1', status: 'sent' }),
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
import { logger } from '../lib/logger';
import {
  buildVerifyUrl,
  cleanupExpiredEmailVerificationTokens,
  consumeEmailVerificationToken,
  createEmailVerificationToken,
  issueEmailVerification,
  needsEmailVerification,
  sendEmailVerificationEmail,
  startEmailVerification,
} from './email-verification.service';

const tokens = prisma.emailVerificationToken as unknown as Record<string, jest.Mock>;
const users = prisma.user as unknown as Record<string, jest.Mock>;
const mockSend = sendReactEmailWithAudit as jest.Mock;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const future = () => new Date(Date.now() + 60 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  tokens.updateMany.mockResolvedValue({ count: 1 });
  tokens.create.mockResolvedValue({ id: 'new_token' });
  users.updateMany.mockResolvedValue({ count: 1 });
  mockSend.mockResolvedValue({ messageId: 'mid_1', status: 'sent' });
});

describe('needsEmailVerification', () => {
  it('is true only for a required and unverified account', () => {
    expect(needsEmailVerification({ emailVerificationRequired: true, emailVerified: null })).toBe(true);
    expect(needsEmailVerification({ emailVerificationRequired: true, emailVerified: new Date() })).toBe(false);
    // Accounts from before verification shipped are never gated.
    expect(needsEmailVerification({ emailVerificationRequired: false, emailVerified: null })).toBe(false);
  });
});

describe('createEmailVerificationToken', () => {
  it('stores only the hash and leaves earlier links alone', async () => {
    const { rawToken: raw, tokenId } = await createEmailVerificationToken('user_1');

    expect(tokenId).toBe('new_token');
    expect(tokens.updateMany).not.toHaveBeenCalled();
    const created = tokens.create.mock.calls[0][0].data;
    expect(created.userId).toBe('user_1');
    expect(created.tokenHash).toBe(sha256(raw));
    expect(created.tokenHash).not.toBe(raw);
    const ttlHours = (created.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(23.9);
    expect(ttlHours).toBeLessThanOrEqual(24);
  });
});

describe('buildVerifyUrl', () => {
  it('points at the web verify page with the token', () => {
    expect(buildVerifyUrl('abc')).toBe('https://loamlogger.app/verify-email?token=abc');
  });
});

describe('sendEmailVerificationEmail', () => {
  it('sends past the unsubscribe flag with the audit fields', async () => {
    await sendEmailVerificationEmail({ id: 'user_1', email: 'rider@example.com' }, 'raw', 'user_action');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'rider@example.com',
        userId: 'user_1',
        emailType: 'email_verification',
        triggerSource: 'user_action',
        bypassUnsubscribe: true,
      })
    );
  });
});

describe('issueEmailVerification', () => {
  it('retires older links only after the new email is sent', async () => {
    await issueEmailVerification({ id: 'user_1', email: 'rider@example.com' }, 'user_action');

    expect(mockSend).toHaveBeenCalled();
    expect(tokens.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', usedAt: null, id: { not: 'new_token' } },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockSend.mock.invocationCallOrder[0]).toBeLessThan(
      tokens.updateMany.mock.invocationCallOrder[0]
    );
  });

  it('keeps the earlier link working when the send fails', async () => {
    mockSend.mockRejectedValue(new Error('resend down'));

    await expect(
      issueEmailVerification({ id: 'user_1', email: 'rider@example.com' }, 'user_action')
    ).rejects.toThrow('resend down');
    expect(tokens.updateMany).not.toHaveBeenCalled();
  });
});

describe('startEmailVerification', () => {
  it('swallows a send failure so signup is never failed by it', async () => {
    mockSend.mockRejectedValue(new Error('resend down'));

    await expect(startEmailVerification({ id: 'user_1', email: 'rider@example.com' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('consumeEmailVerificationToken', () => {
  it('rejects an unknown token', async () => {
    tokens.findUnique.mockResolvedValue(null);
    await expect(consumeEmailVerificationToken('nope')).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects an expired token without touching the user', async () => {
    tokens.findUnique.mockResolvedValue({ id: 't1', userId: 'user_1', usedAt: null, expiresAt: past() });
    await expect(consumeEmailVerificationToken('raw')).resolves.toEqual({ ok: false, reason: 'expired' });
    expect(users.updateMany).not.toHaveBeenCalled();
  });

  it('claims the token and sets emailVerified only if it was unset', async () => {
    tokens.findUnique.mockResolvedValue({ id: 't1', userId: 'user_1', usedAt: null, expiresAt: future() });

    await expect(consumeEmailVerificationToken('raw')).resolves.toEqual({ ok: true, userId: 'user_1' });
    expect(tokens.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('raw') } });
    expect(tokens.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(users.updateMany).toHaveBeenCalledWith({
      where: { id: 'user_1', emailVerified: null },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it('treats a used token as success when the address is verified (double click)', async () => {
    tokens.findUnique.mockResolvedValue({ id: 't1', userId: 'user_1', usedAt: past(), expiresAt: future() });
    users.findUnique.mockResolvedValue({ emailVerified: new Date() });

    await expect(consumeEmailVerificationToken('raw')).resolves.toEqual({ ok: true, userId: 'user_1' });
  });

  it('reports a superseded token when the address is still unverified', async () => {
    tokens.findUnique.mockResolvedValue({ id: 't1', userId: 'user_1', usedAt: past(), expiresAt: future() });
    users.findUnique.mockResolvedValue({ emailVerified: null });

    await expect(consumeEmailVerificationToken('raw')).resolves.toEqual({ ok: false, reason: 'already_used' });
  });

  it('does not verify the user when it loses the claim race', async () => {
    tokens.findUnique.mockResolvedValue({ id: 't1', userId: 'user_1', usedAt: null, expiresAt: future() });
    tokens.updateMany.mockResolvedValue({ count: 0 });
    users.findUnique.mockResolvedValue({ emailVerified: null });

    await expect(consumeEmailVerificationToken('raw')).resolves.toEqual({ ok: false, reason: 'already_used' });
    expect(users.updateMany).not.toHaveBeenCalled();
  });
});

describe('cleanupExpiredEmailVerificationTokens', () => {
  it('deletes tokens past the cutoff and returns the count', async () => {
    tokens.deleteMany.mockResolvedValue({ count: 3 });

    await expect(cleanupExpiredEmailVerificationTokens(24)).resolves.toBe(3);
    const cutoff = tokens.deleteMany.mock.calls[0][0].where.expiresAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
  });
});
