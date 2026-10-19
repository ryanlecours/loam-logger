import type { Request, Response, NextFunction, RequestHandler } from 'express';

jest.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('./email.utils', () => ({
  validateEmailFormat: jest.fn().mockReturnValue(true),
}));

jest.mock('./utils', () => ({
  normalizeEmail: jest.fn((e: string) => e.trim().toLowerCase()),
  getClientIp: jest.fn().mockReturnValue('1.2.3.4'),
}));

jest.mock('./login-rate-limit', () => ({
  loginEmailKey: jest.fn((e: string) => `hash(${e})`),
}));

jest.mock('./session', () => ({
  clearSessionCookie: jest.fn(),
}));

jest.mock('../services/account-deletion-request.service', () => ({
  confirmAccountDeletion: jest.fn(),
  sendAccountDeletionEmail: jest.fn(),
}));

jest.mock('../services/account-deletion.service', () => {
  class BillingCancellationError extends Error {
    constructor(cause: unknown) {
      super('Failed to cancel Stripe billing before account deletion', { cause });
      this.name = 'BillingCancellationError';
    }
  }
  return { BillingCancellationError };
});

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import router from './delete-account-email.route';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit } from '../lib/rate-limit';
import { validateEmailFormat } from './email.utils';
import { clearSessionCookie } from './session';
import { confirmAccountDeletion, sendAccountDeletionEmail } from '../services/account-deletion-request.service';
import { BillingCancellationError } from '../services/account-deletion.service';

const mockFindUnique = prisma.user.findUnique as unknown as jest.Mock;
const mockRateLimit = checkAuthRateLimit as jest.Mock;
const mockValidateEmail = validateEmailFormat as jest.Mock;
const mockConfirm = confirmAccountDeletion as jest.Mock;
const mockSendEmail = sendAccountDeletionEmail as jest.Mock;
const mockClearCookie = clearSessionCookie as jest.Mock;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
  const handlers = layer?.route?.stack;
  const handler = handlers?.[handlers.length - 1]?.handle;
  if (!handler) throw new Error(`Handler not found for ${method.toUpperCase()} ${path}`);
  return handler;
}

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

async function call(path: string, body: unknown) {
  const res = createRes();
  const req = { body, headers: {}, cookies: {} } as unknown as Request;
  await getHandler(path, 'post')(req, res as unknown as Response, jest.fn() as NextFunction);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockValidateEmail.mockReturnValue(true);
  mockSendEmail.mockResolvedValue(undefined);
});

describe('POST /delete-account/request', () => {
  it('returns 429 when rate limited, without looking anyone up', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
    const res = await call('/delete-account/request', { email: 'rider@example.com' });

    expect(mockRateLimit).toHaveBeenCalledWith('delete-account-request', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when no email is given', async () => {
    const res = await call('/delete-account/request', {});
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 and sends nothing for an address with no account', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await call('/delete-account/request', { email: 'nobody@example.com' });

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 200 without a lookup for a malformed address', async () => {
    mockValidateEmail.mockReturnValue(false);
    const res = await call('/delete-account/request', { email: 'not-an-email' });

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-string email', async () => {
    const res = await call('/delete-account/request', { email: { $ne: '' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('limits per address too, answering 200 without sending when over it', async () => {
    mockRateLimit.mockImplementation(async (op: string) =>
      op === 'delete-account-request-email' ? { allowed: false, retryAfter: 3600 } : { allowed: true }
    );
    const res = await call('/delete-account/request', { email: 'Rider@Example.com' });

    expect(mockRateLimit).toHaveBeenCalledWith('delete-account-request-email', 'hash(rider@example.com)');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(res.status).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('answers without waiting for the email to send', async () => {
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'rider@example.com', name: null, sessionTokenVersion: 0 });
    mockSendEmail.mockReturnValue(new Promise(() => {}));
    const res = await call('/delete-account/request', { email: 'rider@example.com' });

    expect(mockSendEmail).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('emails the confirmation link to a matching account, looked up by normalized email', async () => {
    const user = { id: 'user_1', email: 'rider@example.com', name: 'Alex', sessionTokenVersion: 0 };
    mockFindUnique.mockResolvedValue(user);
    const res = await call('/delete-account/request', { email: '  Rider@Example.com ' });

    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'rider@example.com' } }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(user);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('still returns 200 when the email fails to send', async () => {
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'rider@example.com', name: null, sessionTokenVersion: 0 });
    mockSendEmail.mockRejectedValue(new Error('Resend down'));
    const res = await call('/delete-account/request', { email: 'rider@example.com' });

    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});

describe('POST /delete-account/confirm', () => {
  it('returns 429 when rate limited, without redeeming the token', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });
    const res = await call('/delete-account/confirm', { token: 't' });

    expect(mockRateLimit).toHaveBeenCalledWith('delete-account-confirm', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('returns 400 when no token is given', async () => {
    const res = await call('/delete-account/confirm', {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('returns TOKEN_EXPIRED for an expired link', async () => {
    mockConfirm.mockResolvedValue({ ok: false, reason: 'expired' });
    const res = await call('/delete-account/confirm', { token: 't' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  it('returns TOKEN_INVALID for a bad or spent link', async () => {
    mockConfirm.mockResolvedValue({ ok: false, reason: 'invalid' });
    const res = await call('/delete-account/confirm', { token: 't' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
    expect(mockClearCookie).not.toHaveBeenCalled();
  });

  it('deletes the account and clears any session cookie', async () => {
    mockConfirm.mockResolvedValue({ ok: true, userId: 'user_1' });
    const res = await call('/delete-account/confirm', { token: 't' });

    expect(mockConfirm).toHaveBeenCalledWith('t');
    expect(mockClearCookie).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('answers 503 BILLING_CANCELLATION_FAILED when Stripe could not be cancelled', async () => {
    mockConfirm.mockRejectedValue(new BillingCancellationError(new Error('stripe down')));
    const res = await call('/delete-account/confirm', { token: 't' });

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BILLING_CANCELLATION_FAILED' }),
    );
    expect(mockClearCookie).not.toHaveBeenCalled();
  });

  it('answers 500 on any other failure', async () => {
    mockConfirm.mockRejectedValue(new Error('db down'));
    const res = await call('/delete-account/confirm', { token: 't' });

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
