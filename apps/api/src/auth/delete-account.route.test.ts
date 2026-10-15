import type { Request, Response, NextFunction } from 'express';

// Mock dependencies BEFORE importing the router. The deletion itself
// (Stripe included) is covered in services/account-deletion.service.test.ts;
// this file covers only the HTTP mapping.
const mockDeleteUserAccount = jest.fn();

jest.mock('../services/account-deletion.service', () => {
  class BillingCancellationError extends Error {
    constructor(cause: unknown) {
      super('Failed to cancel Stripe billing before account deletion', { cause });
      this.name = 'BillingCancellationError';
    }
  }
  return {
    deleteUserAccount: (...args: unknown[]) => mockDeleteUserAccount(...args),
    BillingCancellationError,
  };
});

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logError: jest.fn(),
}));

jest.mock('./session', () => ({
  clearSessionCookie: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import deleteAccountRouter from './delete-account.route';
import { BillingCancellationError } from '../services/account-deletion.service';
import { clearSessionCookie } from './session';

function createApp(uid: string | null = 'user-1') {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (uid) req.sessionUser = { uid } as Request['sessionUser'];
    next();
  });
  app.use('/auth', deleteAccountRouter);
  return app;
}

describe('DELETE /auth/delete-account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteUserAccount.mockResolvedValue({ email: 'rider@example.com' });
  });

  it('returns 401 without a session and deletes nothing', async () => {
    const res = await request(createApp(null)).delete('/auth/delete-account');

    expect(res.status).toBe(401);
    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
  });

  it('deletes the session user and clears the cookie', async () => {
    const res = await request(createApp()).delete('/auth/delete-account');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'Account successfully deleted' });
    expect(mockDeleteUserAccount).toHaveBeenCalledWith('user-1');
    expect(clearSessionCookie).toHaveBeenCalled();
  });

  it('returns 503 BILLING_CANCELLATION_FAILED and keeps the session when Stripe fails', async () => {
    mockDeleteUserAccount.mockRejectedValue(new BillingCancellationError(new Error('Stripe is down')));

    const res = await request(createApp()).delete('/auth/delete-account');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('BILLING_CANCELLATION_FAILED');
    expect(res.body.error).toMatch(/has not been deleted/);
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 500 on other errors', async () => {
    mockDeleteUserAccount.mockRejectedValue(new Error('DB unavailable'));

    const res = await request(createApp()).delete('/auth/delete-account');

    expect(res.status).toBe(500);
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });
});
