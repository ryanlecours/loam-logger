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

jest.mock('../services/email-sign-in-grant.service', () => ({
  EMAIL_VERIFICATION_PENDING_CODE: 'EMAIL_VERIFICATION_PENDING',
  SIGN_IN_GRANT_INVALID_CODE: 'SIGN_IN_GRANT_INVALID',
  redeemSignInGrant: jest.fn(),
}));

jest.mock('./session-issuer', () => ({
  issueWebSession: jest.fn().mockResolvedValue(undefined),
  issueMobileTokens: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
}));

jest.mock('./csrf', () => ({
  setCsrfCookie: jest.fn().mockReturnValue('csrf-token'),
}));

jest.mock('./recent-auth', () => ({
  updateLastAuthAt: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/logger', () => {
  const log = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { logger: log, createLogger: () => log };
});

import router from './email-verification.route';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit } from '../lib/rate-limit';
import {
  consumeEmailVerificationToken,
  sendVerificationEmailWithinLimit,
} from '../services/email-verification.service';
import { redeemSignInGrant } from '../services/email-sign-in-grant.service';
import { issueMobileTokens, issueWebSession } from './session-issuer';
import { updateLastAuthAt } from './recent-auth';

const mockUserFindUnique = prisma.user.findUnique as unknown as jest.Mock;
const mockCheckAuthRateLimit = checkAuthRateLimit as jest.Mock;
const mockConsume = consumeEmailVerificationToken as jest.Mock;
const mockSend = sendVerificationEmailWithinLimit as jest.Mock;
const mockRedeem = redeemSignInGrant as jest.Mock;

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
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
}

async function call(path: string, body: unknown, cookies: Record<string, string> = {}) {
  const res = createMockResponse();
  await getHandler(path, 'post')(
    { body, headers: {}, cookies } as unknown as Request,
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
    mockUserFindUnique.mockResolvedValue({ email: 'rider@example.com' });

    const res = await call('/verify-email', { token: 'good' });

    expect(mockConsume).toHaveBeenCalledWith('good');
    expect(res.json).toHaveBeenCalledWith({ ok: true, email: 'rider@example.com' });
  });

  it('verifies only: the link starts no session and hands out no grant', async () => {
    mockConsume.mockResolvedValue({ ok: true, userId: 'user_1' });

    const res = await call('/verify-email', { token: 'good' });

    expect(issueWebSession).not.toHaveBeenCalled();
    expect(issueMobileTokens).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
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
    mockUserFindUnique.mockResolvedValue({ email: 'rider@example.com', emailVerified: new Date() });

    const res = await call('/verify-email', { token: 'used' });

    expect(res.json).toHaveBeenCalledWith({ ok: true, alreadyVerified: true, email: 'rider@example.com' });
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

  it('answers without waiting on the send, so timing does not reveal pending accounts', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_1',
      email: 'rider@example.com',
      name: null,
      emailVerificationRequired: true,
      emailVerified: null,
    });
    mockSend.mockReturnValueOnce(new Promise(() => {}));

    const res = await call('/resend-verification', { email: 'rider@example.com' });

    expect(mockSend).toHaveBeenCalled();
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

const grantUser = {
  id: 'user_1',
  email: 'rider@example.com',
  name: 'Rider',
  avatarUrl: null,
  mustChangePassword: false,
};

describe('POST /verify-email/complete (web)', () => {
  const grantCookie = { ll_signin_grant: 'grant-secret' };
  const waitingOn = { email: 'rider@example.com' };

  it('signs this browser in once the email is verified, then drops the grant cookie', async () => {
    mockRedeem.mockResolvedValue({ ok: true, user: grantUser });

    const res = await call('/verify-email/complete', waitingOn, grantCookie);

    expect(mockRedeem).toHaveBeenCalledWith('grant-secret', 'web', 'rider@example.com');
    expect(issueWebSession).toHaveBeenCalledWith(res, { id: 'user_1', email: 'rider@example.com' });
    expect(updateLastAuthAt).toHaveBeenCalledWith('user_1');
    expect(res.clearCookie).toHaveBeenCalledWith('ll_signin_grant', expect.objectContaining({ path: '/auth/verify-email' }));
    expect(res.json).toHaveBeenCalledWith({ ok: true, mustChangePassword: false, csrfToken: 'csrf-token' });
  });

  it('answers 202 pending while the email is unverified, keeping the cookie for the next poll', async () => {
    mockRedeem.mockResolvedValue({ ok: false, reason: 'pending' });

    const res = await call('/verify-email/complete', waitingOn, grantCookie);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ pending: true, code: 'EMAIL_VERIFICATION_PENDING' });
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(issueWebSession).not.toHaveBeenCalled();
  });

  it('answers 401 and clears the cookie for a grant that can never sign in', async () => {
    mockRedeem.mockResolvedValue({ ok: false, reason: 'invalid' });

    const res = await call('/verify-email/complete', waitingOn, grantCookie);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SIGN_IN_GRANT_INVALID' }));
    expect(res.clearCookie).toHaveBeenCalled();
    expect(issueWebSession).not.toHaveBeenCalled();
  });

  it('answers 401 without a lookup when the browser holds no grant', async () => {
    const res = await call('/verify-email/complete', waitingOn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('refuses a request that does not name the account it is waiting on, before reading the grant', async () => {
    const res = await call('/verify-email/complete', {}, grantCookie);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_REQUIRED' }));
    expect(mockRedeem).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('ignores a secret sent in the body: the web grant only travels in its cookie', async () => {
    const res = await call('/verify-email/complete', { ...waitingOn, secret: 'grant-secret' });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('returns 429 before reading the grant when the IP is over the limit', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await call('/verify-email/complete', waitingOn, grantCookie);

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('verify-email-complete', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockRedeem).not.toHaveBeenCalled();
  });
});

describe('POST /mobile/verify-email/complete', () => {
  it('answers like /mobile/login once the email is verified', async () => {
    mockRedeem.mockResolvedValue({ ok: true, user: grantUser });

    const res = await call('/mobile/verify-email/complete', { secret: 'grant-secret' });

    expect(mockRedeem).toHaveBeenCalledWith('grant-secret', 'mobile', undefined);
    expect(issueMobileTokens).toHaveBeenCalledWith({ id: 'user_1', email: 'rider@example.com' });
    expect(updateLastAuthAt).toHaveBeenCalledWith('user_1');
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 'user_1', email: 'rider@example.com', name: 'Rider', avatarUrl: null },
    });
  });

  it('passes along the address the verify screen is waiting on', async () => {
    mockRedeem.mockResolvedValue({ ok: true, user: grantUser });

    await call('/mobile/verify-email/complete', { secret: 'grant-secret', email: 'rider@example.com' });

    expect(mockRedeem).toHaveBeenCalledWith('grant-secret', 'mobile', 'rider@example.com');
  });

  it('answers 202 pending while the email is unverified', async () => {
    mockRedeem.mockResolvedValue({ ok: false, reason: 'pending' });

    const res = await call('/mobile/verify-email/complete', { secret: 'grant-secret' });

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ pending: true, code: 'EMAIL_VERIFICATION_PENDING' });
    expect(issueMobileTokens).not.toHaveBeenCalled();
  });

  it('answers 401 for a grant that can never sign in', async () => {
    mockRedeem.mockResolvedValue({ ok: false, reason: 'invalid' });

    const res = await call('/mobile/verify-email/complete', { secret: 'nope' });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SIGN_IN_GRANT_INVALID' }));
    expect(issueMobileTokens).not.toHaveBeenCalled();
  });

  it('returns 429 when the IP is over the limit', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await call('/mobile/verify-email/complete', { secret: 'grant-secret' });

    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockRedeem).not.toHaveBeenCalled();
  });
});
