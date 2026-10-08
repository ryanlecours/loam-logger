import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockCheckAuthRateLimit = jest.fn();
const mockConsume = jest.fn();
const mockIssue = jest.fn();
const mockUserFindUnique = jest.fn();

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
}));

jest.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) } },
}));

jest.mock('../services/email-verification.service', () => ({
  consumeEmailVerificationToken: (...args: unknown[]) => mockConsume(...args),
  issueEmailVerification: (...args: unknown[]) => mockIssue(...args),
  needsEmailVerification: (u: { emailVerificationRequired: boolean; emailVerified: Date | null }) =>
    u.emailVerificationRequired && !u.emailVerified,
}));

jest.mock('./utils', () => ({
  getClientIp: jest.fn().mockReturnValue('1.2.3.4'),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import router from './email-verification.route';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  const handlers = layer?.route?.stack;
  const handler = handlers?.[handlers.length - 1]?.handle;
  if (!handler) throw new Error(`Handler not found for ${path}`);
  return handler;
}

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  };
}

async function call(handler: RequestHandler, req: Partial<Request>) {
  const res = createMockResponse();
  await handler(req as Request, res as unknown as Response, jest.fn() as NextFunction);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
});

describe('POST /verify-email', () => {
  const handler = getHandler('/verify-email', 'post');

  it('returns 429 before touching the token when the IP is over the limit', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await call(handler, { body: { token: 't' } });

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('verify-email', '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('returns 400 TOKEN_INVALID with no token', async () => {
    const res = await call(handler, { body: {} });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('returns 400 TOKEN_INVALID for an unknown token', async () => {
    mockConsume.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await call(handler, { body: { token: 't' } });

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it.each(['expired', 'already_used'])('returns 400 TOKEN_EXPIRED for a %s token', async (reason) => {
    mockConsume.mockResolvedValue({ ok: false, reason });

    const res = await call(handler, { body: { token: 't' } });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  it('returns 200 when the token verifies', async () => {
    mockConsume.mockResolvedValue({ ok: true, userId: 'user_1' });

    const res = await call(handler, { body: { token: 't' } });

    expect(mockConsume).toHaveBeenCalledWith('t');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});

describe('POST /resend-verification', () => {
  const handler = getHandler('/resend-verification', 'post');
  const signedIn = { sessionUser: { uid: 'user_1', email: 'rider@example.com' } } as Partial<Request>;

  it('returns 401 when not signed in', async () => {
    const res = await call(handler, {});

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('rate limits per user, not per IP', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 600 });

    const res = await call(handler, signedIn);

    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('resend-verification', 'user_1');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('sends nothing to an account that does not need verifying', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'user_1',
      email: 'rider@example.com',
      emailVerified: new Date(),
      emailVerificationRequired: true,
    });

    const res = await call(handler, signedIn);

    expect(res.json).toHaveBeenCalledWith({ ok: true, alreadyVerified: true });
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('issues a fresh token and sends it', async () => {
    const user = {
      id: 'user_1',
      email: 'rider@example.com',
      emailVerified: null,
      emailVerificationRequired: true,
    };
    mockUserFindUnique.mockResolvedValue(user);
    mockIssue.mockResolvedValue(undefined);

    const res = await call(handler, signedIn);

    expect(mockIssue).toHaveBeenCalledWith(user, 'user_action');
    expect(res.json).toHaveBeenCalledWith({ ok: true, alreadyVerified: false });
  });
});
