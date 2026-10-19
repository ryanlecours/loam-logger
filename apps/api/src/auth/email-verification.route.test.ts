import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock dependencies BEFORE importing the router
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

jest.mock('./utils', () => ({
  normalizeEmail: jest.fn((e: string) => e.trim().toLowerCase() || null),
  getClientIp: jest.fn().mockReturnValue('1.2.3.4'),
}));

jest.mock('../services/email-verification.service', () => ({
  consumeEmailVerificationToken: jest.fn(),
  isEmailVerificationPending: (u: { emailVerificationRequired: boolean; emailVerified: Date | null }) =>
    u.emailVerificationRequired && !u.emailVerified,
  sendVerificationEmailWithinLimit: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import router from './email-verification.route';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit } from '../lib/rate-limit';
import {
  consumeEmailVerificationToken,
  sendVerificationEmailWithinLimit,
} from '../services/email-verification.service';

const mockUserFindUnique = prisma.user.findUnique as unknown as jest.Mock;
const mockCheckAuthRateLimit = checkAuthRateLimit as jest.Mock;
const mockConsume = consumeEmailVerificationToken as jest.Mock;
const mockSend = sendVerificationEmailWithinLimit as jest.Mock;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
  const handlers = layer?.route?.stack;
  const handle = handlers?.[handlers.length - 1]?.handle;
  if (!handle) throw new Error(`Handler not found for ${path}`);
  return handle;
}

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

async function call(path: string, body: unknown) {
  const res = createMockResponse();
  await getHandler(path, 'post')(
    { body, headers: {}, cookies: {} } as unknown as Request,
    res as unknown as Response,
    jest.fn() as NextFunction,
  );
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
});

describe('POST /verify-email', () => {
  it('confirms the address for a valid token', async () => {
    mockConsume.mockResolvedValue({ ok: true, userId: 'user_1' });

    const res = await call('/verify-email', { token: 'good' });

    expect(mockConsume).toHaveBeenCalledWith('good');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('answers TOKEN_EXPIRED for an expired link', async () => {
    mockConsume.mockResolvedValue({ ok: false, reason: 'expired' });

    const res = await call('/verify-email', { token: 'old' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  it('answers TOKEN_INVALID for an unknown link', async () => {
    mockConsume.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await call('/verify-email', { token: 'nope' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('treats a reused link as success when the address is already verified', async () => {
    mockConsume.mockResolvedValue({ ok: false, reason: 'already_used', userId: 'user_1' });
    mockUserFindUnique.mockResolvedValue({ emailVerified: new Date() });

    const res = await call('/verify-email', { token: 'used' });

    expect(res.json).toHaveBeenCalledWith({ ok: true, alreadyVerified: true });
  });

  it('rejects a reused link whose account is still unverified (a superseded link)', async () => {
    mockConsume.mockResolvedValue({ ok: false, reason: 'already_used', userId: 'user_1' });
    mockUserFindUnique.mockResolvedValue({ emailVerified: null });

    const res = await call('/verify-email', { token: 'superseded' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('requires a token', async () => {
    const res = await call('/verify-email', {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('rate limits by IP before touching the token', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await call('/verify-email', { token: 'guess' });

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('verify-email', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockConsume).not.toHaveBeenCalled();
  });
});

describe('POST /resend-verification', () => {
  it('sends a fresh link to an account waiting on verification', async () => {
    const user = {
      id: 'user_1',
      email: 'rider@example.com',
      name: 'Rider',
      emailVerificationRequired: true,
      emailVerified: null,
    };
    mockUserFindUnique.mockResolvedValue(user);

    const res = await call('/resend-verification', { email: 'Rider@Example.com' });

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'rider@example.com' } }),
    );
    expect(mockSend).toHaveBeenCalledWith(user, 'user_action');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const res = await call('/resend-verification', { email: 'nobody@example.com' });

    expect(mockSend).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('answers the same for an already verified account and sends nothing', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_1',
      email: 'rider@example.com',
      name: null,
      emailVerificationRequired: true,
      emailVerified: new Date(),
    });

    const res = await call('/resend-verification', { email: 'rider@example.com' });

    expect(mockSend).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('never sends to an account from before verification shipped', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_1',
      email: 'rider@example.com',
      name: null,
      emailVerificationRequired: false,
      emailVerified: null,
    });

    await call('/resend-verification', { email: 'rider@example.com' });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rate limits by IP', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await call('/resend-verification', { email: 'rider@example.com' });

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('resend-verification', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
