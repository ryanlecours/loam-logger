// Set env before importing anything that reads SESSION_SECRET at load time
const originalEnv = process.env;
process.env = { ...originalEnv, SESSION_SECRET: 'test-secret' };

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));
jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  setUser: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { attachUser, enrichContextFromSession, sessionMiddleware, setSessionCookie } from './session';
import { generateAccessToken } from './token';
import { prisma } from '../lib/prisma';
import {
  createRequestContext,
  getRequestContext,
  runWithRequestContext,
} from '../lib/requestContext';

const mockUserFindUnique = prisma.user.findUnique as unknown as jest.Mock;

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 0 });
});

// Mirrors the server.ts order: request context, cookies, then the session
// bundle. The final handler reports what the context ended up holding.
function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.use((req, _res, next) => {
    runWithRequestContext(createRequestContext(req.method, req.path), () => next());
  });
  app.use(sessionMiddleware);
  app.use((_req, res) => {
    const context = getRequestContext();
    res.json({ userId: context?.userId ?? null, client: context?.client ?? null });
  });
  return app;
}

const cookie = () => `ll_session=${jwt.sign({ uid: 'user_web', v: 0 }, 'test-secret')}`;
const bearer = () => `Bearer ${generateAccessToken({ uid: 'user_mobile', v: 0 })}`;

describe('sessionMiddleware', () => {
  it('runs attachUser before tagging the context', () => {
    expect(sessionMiddleware).toEqual([attachUser, enrichContextFromSession]);
  });

  it('tags a cookie session as web', async () => {
    const res = await request(makeApp()).post('/graphql').set('Cookie', cookie());
    expect(res.body).toEqual({ userId: 'user_web', client: { platform: 'web' } });
  });

  it('tags a bearer session without the header as mobile', async () => {
    const res = await request(makeApp()).post('/graphql').set('Authorization', bearer());
    expect(res.body).toEqual({ userId: 'user_mobile', client: { platform: 'mobile' } });
  });

  it('prefers the x-loam-client header over the auth transport', async () => {
    const res = await request(makeApp())
      .post('/graphql')
      .set('Authorization', bearer())
      .set('x-loam-client', 'ios/1.4.0');
    expect(res.body).toEqual({
      userId: 'user_mobile',
      client: { platform: 'ios', appVersion: '1.4.0' },
    });
  });

  it('tags the unauthenticated mobile auth routes as mobile', async () => {
    const res = await request(makeApp()).post('/auth/mobile/signup');
    expect(res.body).toEqual({ userId: null, client: { platform: 'mobile' } });
  });

  it('leaves requests no client made untagged', async () => {
    const res = await request(makeApp()).post('/webhooks/strava');
    expect(res.body).toEqual({ userId: null, client: null });
  });

  it('does not tag a revoked session by its transport', async () => {
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 1 });
    const res = await request(makeApp()).post('/graphql').set('Cookie', cookie());
    expect(res.body).toEqual({ userId: null, client: null });
  });
});

// Every token the API signs is a JWT, and before this fix all of them were
// signed with SESSION_SECRET. The cookie path checked only the signature and
// sessionTokenVersion (a missing `v` reads as 0, the column default), so any
// of them carrying a uid worked as a web session. The unsubscribe token sits
// in every marketing email for 90 days: forwarding one let the recipient sign
// in as the rider.
describe('the ll_session cookie accepts only web session tokens', () => {
  const asCookie = (token: string) => `ll_session=${token}`;
  const signedIn = async (token: string) =>
    (await request(makeApp()).post('/graphql').set('Cookie', asCookie(token))).body.userId;

  it('rejects an unsubscribe token signed with SESSION_SECRET (forwarded marketing email)', async () => {
    const unsubscribe = jwt.sign({ uid: 'victim', purpose: 'unsubscribe' }, 'test-secret', { expiresIn: '90d' });
    expect(await signedIn(unsubscribe)).toBeNull();
  });

  it('rejects mobile access and refresh tokens', async () => {
    const access = generateAccessToken({ uid: 'victim', v: 0 });
    const refresh = jwt.sign({ uid: 'victim', v: 0, typ: 'refresh', sid: 's', jti: 'j' }, 'test-secret', {
      expiresIn: '365d',
    });
    expect(await signedIn(access)).toBeNull();
    expect(await signedIn(refresh)).toBeNull();
  });

  it('rejects any token with a claim a web session never carries', async () => {
    const odd = jwt.sign({ uid: 'victim', v: 0, role: 'ADMIN' }, 'test-secret', { expiresIn: '7d' });
    expect(await signedIn(odd)).toBeNull();
  });

  it('accepts a session cookie as issued before typ existed', async () => {
    const legacy = jwt.sign({ uid: 'user_web', email: 'r@example.com', authAt: Date.now(), v: 0 }, 'test-secret', {
      expiresIn: '7d',
    });
    expect(await signedIn(legacy)).toBe('user_web');
  });

  it('accepts a session cookie issued now', async () => {
    const cookieSpy = jest.fn();
    setSessionCookie({ cookie: cookieSpy } as never, { uid: 'user_web', email: 'r@example.com', authAt: Date.now(), v: 0 });
    const issued = cookieSpy.mock.calls[0][1] as string;

    expect(jwt.decode(issued)).toMatchObject({ uid: 'user_web', typ: 'web' });
    expect(await signedIn(issued)).toBe('user_web');
  });

  // The reverse direction: the bearer path takes access tokens only.
  it('does not accept a web session cookie as a bearer token', async () => {
    const cookieSpy = jest.fn();
    setSessionCookie({ cookie: cookieSpy } as never, { uid: 'user_web', authAt: Date.now(), v: 0 });
    const res = await request(makeApp())
      .post('/graphql')
      .set('Authorization', `Bearer ${cookieSpy.mock.calls[0][1]}`);
    expect(res.body.userId).toBeNull();
  });
});
