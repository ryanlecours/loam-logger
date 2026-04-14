import type { Request, Response, NextFunction } from 'express';

// Set env before importing the module under test
const originalEnv = process.env;
process.env = { ...originalEnv, SESSION_SECRET: 'test-secret' };

// Mock dependencies BEFORE importing session.ts
jest.mock('jsonwebtoken');
jest.mock('./token', () => ({
  extractBearerToken: jest.fn(),
  verifyToken: jest.fn(),
}));
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
}));

import * as jwt from 'jsonwebtoken';
import * as Sentry from '@sentry/node';
import { attachUser, type SessionUser } from './session';
import { extractBearerToken, verifyToken } from './token';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const mockedJwt = jwt as jest.Mocked<typeof jwt>;
const mockExtractBearerToken = extractBearerToken as jest.Mock;
const mockVerifyToken = verifyToken as jest.Mock;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockUserFindUnique = mockPrisma.user.findUnique as unknown as jest.Mock;
const mockSentryCapture = Sentry.captureException as jest.Mock;
const mockLoggerError = logger.error as unknown as jest.Mock;
const mockLoggerDebug = logger.debug as unknown as jest.Mock;

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
});

type MockReq = Partial<Request> & { sessionUser?: SessionUser; cookies?: Record<string, string> };

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return { cookies: {}, headers: {}, ...overrides } as MockReq;
}

/** attachUser is a sync wrapper that kicks off an async IIFE; this helper waits for it to resolve. */
async function runAttachUser(req: MockReq): Promise<void> {
  return new Promise<void>((resolve) => {
    const next: NextFunction = () => resolve();
    attachUser(req as Request, {} as Response, next);
  });
}

describe('attachUser — cookie session (web)', () => {
  it('attaches sessionUser when cookie is valid and token version matches DB', async () => {
    const payload: SessionUser = { uid: 'user_1', email: 'a@b.com', v: 5 };
    mockedJwt.verify.mockReturnValue(payload as never);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 5 });

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toEqual(payload);
  });

  it('rejects a cookie whose v is stale (less than current sessionTokenVersion)', async () => {
    // Attacker token minted when version was 3; DB is now 4 after a password reset.
    const stalePayload: SessionUser = { uid: 'user_1', email: 'a@b.com', v: 3 };
    mockedJwt.verify.mockReturnValue(stalePayload as never);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 4 });

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
  });

  it('rejects a cookie whose v is ahead of DB (forged/mismatched)', async () => {
    const forgedPayload: SessionUser = { uid: 'user_1', v: 99 };
    mockedJwt.verify.mockReturnValue(forgedPayload as never);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 4 });

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
  });

  it('treats a missing v claim as v=0 (backwards compat with pre-bump tokens)', async () => {
    // Old token from before the sessionTokenVersion work — no v field.
    const legacyPayload = { uid: 'user_1', email: 'a@b.com' } as SessionUser;
    mockedJwt.verify.mockReturnValue(legacyPayload as never);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 0 });

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toEqual(legacyPayload);
  });

  it('rejects a legacy (no-v) token once the user has had a revocation event', async () => {
    const legacyPayload = { uid: 'user_1' } as SessionUser;
    mockedJwt.verify.mockReturnValue(legacyPayload as never);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 1 });

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
  });

  it('rejects the cookie and falls through to bearer when JWT verification fails', async () => {
    mockedJwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    mockExtractBearerToken.mockReturnValue(null);

    const req = makeReq({ cookies: { ll_session: 'bad-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
    // Falls through to check bearer auth
    expect(mockExtractBearerToken).toHaveBeenCalled();
  });

  it('rejects the cookie when the user no longer exists (fail-closed)', async () => {
    mockedJwt.verify.mockReturnValue({ uid: 'deleted_user', v: 0 } as never);
    mockUserFindUnique.mockResolvedValue(null);

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
  });

  it('rejects the cookie when the DB lookup errors (fail-closed) and alerts Sentry + error log', async () => {
    mockedJwt.verify.mockReturnValue({ uid: 'user_1', v: 0 } as never);
    const dbErr = new Error('DB unavailable');
    mockUserFindUnique.mockRejectedValue(dbErr);

    const req = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
    // Auth failing closed is critical — on-call needs to see this immediately.
    expect(mockSentryCapture).toHaveBeenCalledWith(dbErr, expect.objectContaining({
      tags: expect.objectContaining({ component: 'auth', severity: 'critical' }),
    }));
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('rate-limits Sentry alerts during a sustained DB outage (first fires, bursts suppressed)', async () => {
    // Fresh module load so the alert-cooldown state is zeroed for this test.
    await jest.isolateModulesAsync(async () => {
      jest.doMock('@sentry/node', () => ({ captureException: jest.fn() }));
      jest.doMock('jsonwebtoken');
      jest.doMock('./token', () => ({
        extractBearerToken: jest.fn().mockReturnValue(null),
        verifyToken: jest.fn(),
      }));
      jest.doMock('../lib/prisma', () => ({
        prisma: { user: { findUnique: jest.fn() } },
      }));
      jest.doMock('../lib/logger', () => ({
        logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      }));

      const freshJwt = (await import('jsonwebtoken')) as jest.Mocked<typeof import('jsonwebtoken')>;
      const freshSentry = (await import('@sentry/node')) as unknown as {
        captureException: jest.Mock;
      };
      const freshLogger = ((await import('../lib/logger')) as unknown as {
        logger: { error: jest.Mock; debug: jest.Mock };
      }).logger;
      const freshPrismaFindUnique = ((await import('../lib/prisma')) as unknown as {
        prisma: { user: { findUnique: jest.Mock } };
      }).prisma.user.findUnique;
      const { attachUser: freshAttachUser } = await import('./session');

      freshJwt.verify.mockReturnValue({ uid: 'user_x', v: 0 } as never);
      freshPrismaFindUnique.mockRejectedValue(new Error('DB down'));

      const run = () =>
        new Promise<void>((resolve) => {
          const next: NextFunction = () => resolve();
          freshAttachUser(
            { cookies: { ll_session: 'jwt' }, headers: {} } as Request,
            {} as Response,
            next,
          );
        });

      // First hit during the outage should alert.
      await run();
      expect(freshSentry.captureException).toHaveBeenCalledTimes(1);
      expect(freshLogger.error).toHaveBeenCalledTimes(1);

      // Next several hits within the cooldown window should stay silent on
      // Sentry/error, going to debug instead — otherwise a DB outage floods the
      // alert channel with thousands of duplicates per minute.
      await run();
      await run();
      await run();

      expect(freshSentry.captureException).toHaveBeenCalledTimes(1);
      expect(freshLogger.error).toHaveBeenCalledTimes(1);
      expect(freshLogger.debug).toHaveBeenCalledTimes(3);
    });
  });
});

describe('attachUser — bearer token (mobile)', () => {
  it('attaches sessionUser when bearer token is valid and version matches', async () => {
    const payload = { uid: 'user_1', email: 'a@b.com', v: 2 };
    mockExtractBearerToken.mockReturnValue('mobile-access-token');
    mockVerifyToken.mockReturnValue(payload);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 2 });

    const req = makeReq();
    await runAttachUser(req);

    expect(req.sessionUser).toEqual(payload);
  });

  it('rejects a bearer token whose v is stale (mobile device still holding pre-reset token)', async () => {
    const stalePayload = { uid: 'user_1', v: 0 };
    mockExtractBearerToken.mockReturnValue('stale-mobile-token');
    mockVerifyToken.mockReturnValue(stalePayload);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 1 });

    const req = makeReq();
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
  });

  it('does not attach a user when bearer token itself is invalid', async () => {
    mockExtractBearerToken.mockReturnValue('garbage-token');
    mockVerifyToken.mockReturnValue(null);

    const req = makeReq();
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('calls next even when no cookie and no bearer token is present', async () => {
    mockExtractBearerToken.mockReturnValue(null);

    const req = makeReq();
    await runAttachUser(req);

    expect(req.sessionUser).toBeUndefined();
  });
});

describe('attachUser — revocation after sessionTokenVersion bump', () => {
  it('accepts a freshly-issued token then rejects it after a version bump (password reset scenario)', async () => {
    // Token issued with v=0
    const payload = { uid: 'user_1', email: 'a@b.com', v: 0 };
    mockedJwt.verify.mockReturnValue(payload as never);

    // First request: DB is still at v=0 — token valid.
    mockUserFindUnique.mockResolvedValueOnce({ sessionTokenVersion: 0 });
    const req1 = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req1);
    expect(req1.sessionUser).toEqual(payload);

    // User completes a password reset → sessionTokenVersion becomes 1.
    // Next request with the same old cookie should be rejected.
    mockUserFindUnique.mockResolvedValueOnce({ sessionTokenVersion: 1 });
    const req2 = makeReq({ cookies: { ll_session: 'signed-jwt' } });
    await runAttachUser(req2);
    expect(req2.sessionUser).toBeUndefined();
  });

  it('accepts a newly-issued token after the bump (new login works)', async () => {
    // After a reset, user logs in fresh; new token carries v=1.
    const freshPayload = { uid: 'user_1', email: 'a@b.com', v: 1 };
    mockedJwt.verify.mockReturnValue(freshPayload as never);
    mockUserFindUnique.mockResolvedValue({ sessionTokenVersion: 1 });

    const req = makeReq({ cookies: { ll_session: 'fresh-jwt' } });
    await runAttachUser(req);

    expect(req.sessionUser).toEqual(freshPayload);
  });
});
