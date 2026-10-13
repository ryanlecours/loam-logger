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
import { attachUser, enrichContextFromSession, sessionMiddleware } from './session';
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
