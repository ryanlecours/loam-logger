import type { Request, Response, NextFunction } from 'express';

// Mock dependencies BEFORE importing the router. requireAdmin is deliberately
// left real so the non-admin case exercises the actual guard.
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAdminRateLimit: jest.fn().mockResolvedValue({ allowed: true, redisAvailable: true }),
}));

// Everything else the admin router imports just needs to not explode during
// module load.
jest.mock('../services/password-reset.service', () => ({
  createPasswordResetToken: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));
jest.mock('../auth/password.utils', () => ({
  hashPassword: jest.fn(),
  validatePassword: jest.fn().mockReturnValue({ isValid: true }),
}));
jest.mock('../services/email.service', () => ({
  sendEmail: jest.fn(),
  sendReactEmailWithAudit: jest.fn(),
}));
jest.mock('@react-email/render', () => ({
  render: jest.fn().mockResolvedValue('<html></html>'),
}));
jest.mock('../lib/unsubscribe-token', () => ({
  generateUnsubscribeToken: jest.fn().mockReturnValue('tok'),
}));

// One shared object so the test can read what the auth-audit logger saw.
const mockAuditLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logError: jest.fn(),
  createLogger: jest.fn(() => mockAuditLogger),
}));

import express, { type Express } from 'express';
import request from 'supertest';
import router from './admin';
import { prisma } from '../lib/prisma';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { createLogger } from '../lib/logger';

const mockFindUnique = prisma.user.findUnique as unknown as jest.Mock;
const mockUpdateMany = prisma.user.updateMany as unknown as jest.Mock;
const mockCheckAdminRateLimit = checkAdminRateLimit as jest.Mock;
// Read at load time, before beforeEach clears the call record.
const loggerModules = (createLogger as jest.Mock).mock.calls.map((c) => c[0]);

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const RIDER_ID = '11111111-1111-4111-8111-111111111111';
const PATH = `/api/admin/users/${RIDER_ID}/verify-email`;

/**
 * Route prisma.user.findUnique by caller: requireAdmin selects only `role`
 * for the session user, the handler selects `emailVerified` for the target.
 */
function mockUsers(opts: {
  sessionRole?: 'ADMIN' | 'FREE';
  target?: { id: string; emailVerified: Date | null } | null;
}) {
  mockFindUnique.mockImplementation(({ where, select }) => {
    if (select?.role) {
      return Promise.resolve(where.id === ADMIN_ID ? { role: opts.sessionRole ?? 'ADMIN' } : null);
    }
    return Promise.resolve(opts.target ?? null);
  });
}

describe('POST /api/admin/users/:userId/verify-email', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const uid = req.header('x-test-uid');
      if (uid) req.sessionUser = { uid } as Request['sessionUser'];
      next();
    });
    app.use('/api/admin', router);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  it('logs to the auth-audit module', () => {
    expect(loggerModules).toContain('auth-audit');
  });

  it('verifies a pending user, logs the admin and target ids, and returns the timestamp', async () => {
    mockUsers({ target: { id: RIDER_ID, emailVerified: null } });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(200);
    // Only emailVerified is written, and only while it is still null:
    // password, sessions, and emailVerificationRequired stay as they are.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: RIDER_ID, emailVerified: null },
      data: { emailVerified: expect.any(Date) },
    });
    const written = mockUpdateMany.mock.calls[0][0].data.emailVerified as Date;
    expect(res.body).toEqual({
      success: true,
      emailVerified: written.toISOString(),
      alreadyVerified: false,
    });
    expect(mockCheckAdminRateLimit).toHaveBeenCalledWith('verifyEmail', RIDER_ID);
    expect(mockAuditLogger.info).toHaveBeenCalledWith(
      { userId: RIDER_ID, adminUserId: ADMIN_ID },
      expect.any(String),
    );
    // Never the email address.
    expect(JSON.stringify(mockAuditLogger.info.mock.calls)).not.toContain('@');
  });

  it('is idempotent: an already-verified user keeps the existing timestamp', async () => {
    const existing = new Date('2026-09-01T08:30:00.000Z');
    mockUsers({ target: { id: RIDER_ID, emailVerified: existing } });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      emailVerified: existing.toISOString(),
      alreadyVerified: true,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditLogger.info).not.toHaveBeenCalled();
    // A repeat click is answered before the rate limit, so it never gets 429.
    expect(mockCheckAdminRateLimit).not.toHaveBeenCalled();
  });

  it('keeps a timestamp written between the lookup and the update', async () => {
    const racedIn = new Date('2026-10-19T11:59:59.000Z');
    mockFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ id: RIDER_ID, emailVerified: null })
      .mockResolvedValueOnce({ emailVerified: racedIn });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      emailVerified: racedIn.toISOString(),
      alreadyVerified: true,
    });
    expect(mockAuditLogger.info).not.toHaveBeenCalled();
  });

  it('returns 404 when the user is deleted between the lookup and the update', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ id: RIDER_ID, emailVerified: null })
      .mockResolvedValueOnce(null);
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(404);
    expect(mockAuditLogger.info).not.toHaveBeenCalled();
  });

  it('returns 500 when the database write fails', async () => {
    mockUsers({ target: { id: RIDER_ID, emailVerified: null } });
    mockUpdateMany.mockRejectedValue(new Error('connection reset'));

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to verify email');
    expect(mockAuditLogger.info).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown user id', async () => {
    mockUsers({ target: null });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(404);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed user id', async () => {
    mockUsers({});

    const res = await request(app)
      .post('/api/admin/users/not-an-id/verify-email')
      .set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(400);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-target rate limit is exceeded', async () => {
    mockUsers({ target: { id: RIDER_ID, emailVerified: null } });
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: false, retryAfter: 5 });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('5');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('is refused for a signed-in non-admin', async () => {
    mockUsers({ sessionRole: 'FREE', target: { id: RIDER_ID, emailVerified: null } });

    const res = await request(app).post(PATH).set('x-test-uid', ADMIN_ID);

    expect(res.status).toBe(403);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('is refused without a session', async () => {
    mockUsers({ target: { id: RIDER_ID, emailVerified: null } });

    const res = await request(app).post(PATH);

    expect(res.status).toBe(401);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
