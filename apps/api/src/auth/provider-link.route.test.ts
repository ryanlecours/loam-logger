import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockComplete = jest.fn();
const mockIssueWebSession = jest.fn().mockResolvedValue(undefined);
const mockIssueMobileTokens = jest.fn();

jest.mock('./provider-link', () => ({
  completeProviderLink: (...args: unknown[]) => mockComplete(...args),
}));
jest.mock('./session-issuer', () => ({
  issueWebSession: (...args: unknown[]) => mockIssueWebSession(...args),
  issueMobileTokens: (...args: unknown[]) => mockIssueMobileTokens(...args),
}));
jest.mock('./csrf', () => ({ setCsrfCookie: jest.fn().mockReturnValue('csrf_token') }));
jest.mock('./recent-auth', () => ({ updateLastAuthAt: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./utils', () => ({ getClientIp: jest.fn().mockReturnValue('1.2.3.4') }));
jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import router from './provider-link.route';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: RequestHandler }> };
}

function getHandler(path: string): RequestHandler {
  const layer = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (l) => l.route?.path === path && l.route?.methods?.post
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
    setHeader: jest.fn().mockReturnThis(),
  };
}

async function call(path: string, body: unknown) {
  const res = createMockResponse();
  await getHandler(path)({ body } as Request, res as unknown as Response, jest.fn() as NextFunction);
  return res;
}

const user = { id: 'legacy', email: 'rider@example.com', name: 'Alex', avatarUrl: null };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /link-provider (web)', () => {
  it('passes the token, password and IP through, and starts a session on success', async () => {
    mockComplete.mockResolvedValue({ ok: true, user });

    const res = await call('/link-provider', { linkToken: 't', password: 'pw' });

    expect(mockComplete).toHaveBeenCalledWith('t', 'pw', '1.2.3.4');
    expect(mockIssueWebSession).toHaveBeenCalledWith(expect.anything(), user);
    expect(res.json).toHaveBeenCalledWith({ ok: true, csrfToken: 'csrf_token' });
  });

  it('answers a wrong password with its status and no session', async () => {
    mockComplete.mockResolvedValue({ ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Incorrect password' });

    const res = await call('/link-provider', { linkToken: 't', password: 'nope' });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Incorrect password', code: 'UNAUTHORIZED' });
    expect(mockIssueWebSession).not.toHaveBeenCalled();
  });

  it('answers a rate limit with 429 and Retry-After', async () => {
    mockComplete.mockResolvedValue({
      ok: false,
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many login attempts. Please try again later.',
      retryAfter: 60,
    });

    const res = await call('/link-provider', { linkToken: 't', password: 'pw' });

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });
});

describe('POST /mobile/link-provider', () => {
  it('returns a token pair and the user on success', async () => {
    mockComplete.mockResolvedValue({ ok: true, user });
    mockIssueMobileTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    const res = await call('/mobile/link-provider', { linkToken: 't', password: 'pw' });

    expect(mockIssueMobileTokens).toHaveBeenCalledWith(user);
    expect(res.json).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r', user });
  });

  it('answers an expired link with 400 LINK_EXPIRED', async () => {
    mockComplete.mockResolvedValue({ ok: false, status: 400, code: 'LINK_EXPIRED', message: 'Start again' });

    const res = await call('/mobile/link-provider', { linkToken: 'old', password: 'pw' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Start again', code: 'LINK_EXPIRED' });
    expect(mockIssueMobileTokens).not.toHaveBeenCalled();
  });
});
