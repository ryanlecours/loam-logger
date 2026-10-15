import type { Request, Response, NextFunction } from 'express';

// Mock dependencies BEFORE importing the router
const mockSubscriptionsRetrieve = jest.fn();
const mockSubscriptionsCancel = jest.fn();
const mockCustomersDel = jest.fn();

jest.mock('../lib/stripe', () => ({
  stripe: {
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
      cancel: (...args: unknown[]) => mockSubscriptionsCancel(...args),
    },
    customers: { del: (...args: unknown[]) => mockCustomersDel(...args) },
  },
  STRIPE_CONFIG: {},
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), delete: jest.fn() },
    ride: { deleteMany: jest.fn() },
    component: { deleteMany: jest.fn() },
    bike: { deleteMany: jest.fn() },
    oauthToken: { deleteMany: jest.fn() },
    userIntegration: { deleteMany: jest.fn() },
    userAccount: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logError: jest.fn(),
}));

jest.mock('../lib/strava-token', () => ({
  revokeStravaTokenForUser: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/garmin-token', () => ({
  revokeGarminTokenForUser: jest.fn().mockResolvedValue(true),
}));

jest.mock('./session', () => ({
  clearSessionCookie: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import deleteAccountRouter from './delete-account.route';
import { prisma } from '../lib/prisma';

const mockPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; delete: jest.Mock };
  ride: { deleteMany: jest.Mock };
  component: { deleteMany: jest.Mock };
  bike: { deleteMany: jest.Mock };
  oauthToken: { deleteMany: jest.Mock };
  userIntegration: { deleteMany: jest.Mock };
  userAccount: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
};

function createApp(uid: string | null = 'user-1') {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (uid) req.sessionUser = { uid } as Request['sessionUser'];
    next();
  });
  app.use('/auth', deleteAccountRouter);
  return app;
}

function stripeError(code: string, message = 'Stripe error') {
  return Object.assign(new Error(message), { type: 'StripeInvalidRequestError', code });
}

describe('DELETE /auth/delete-account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null, stripeSubscriptionId: null });
    mockPrisma.user.delete.mockResolvedValue({ id: 'user-1', email: 'rider@example.com' });
    mockPrisma.ride.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.component.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.bike.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.userAccount.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  it('returns 401 without a session and touches nothing', async () => {
    const res = await request(createApp(null)).delete('/auth/delete-account');

    expect(res.status).toBe(401);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  describe('web subscriber with an active Stripe subscription', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' });
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_123', status: 'active' });
      mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });
      mockCustomersDel.mockResolvedValue({ id: 'cus_123', deleted: true });
    });

    it('cancels the subscription and deletes the customer before deleting any data', async () => {
      const res = await request(createApp()).delete('/auth/delete-account');

      expect(res.status).toBe(200);
      expect(mockSubscriptionsCancel).toHaveBeenCalledWith('sub_123', {
        cancellation_details: { comment: 'loam_account_deleted' },
      });
      expect(mockCustomersDel).toHaveBeenCalledWith('cus_123');
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });

      const cancelOrder = mockSubscriptionsCancel.mock.invocationCallOrder[0];
      const customerDelOrder = mockCustomersDel.mock.invocationCallOrder[0];
      expect(cancelOrder).toBeLessThan(customerDelOrder);
      expect(customerDelOrder).toBeLessThan(mockPrisma.ride.deleteMany.mock.invocationCallOrder[0]);
      expect(customerDelOrder).toBeLessThan(mockPrisma.user.delete.mock.invocationCallOrder[0]);
    });

    it('does not cancel again when the subscription has already ended', async () => {
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_123', status: 'canceled' });

      const res = await request(createApp()).delete('/auth/delete-account');

      expect(res.status).toBe(200);
      expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
      expect(mockCustomersDel).toHaveBeenCalledWith('cus_123');
      expect(mockPrisma.user.delete).toHaveBeenCalled();
    });

    it('treats a subscription or customer Stripe no longer knows about as already done', async () => {
      mockSubscriptionsRetrieve.mockRejectedValue(stripeError('resource_missing', 'No such subscription'));
      mockCustomersDel.mockRejectedValue(stripeError('resource_missing', 'No such customer'));

      const res = await request(createApp()).delete('/auth/delete-account');

      expect(res.status).toBe(200);
      expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).toHaveBeenCalled();
    });
  });

  it('makes no Stripe calls for a user with no Stripe ids', async () => {
    const res = await request(createApp()).delete('/auth/delete-account');

    expect(res.status).toBe(200);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockCustomersDel).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('deletes the customer when there is no recorded subscription (former subscriber)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: null });
    mockCustomersDel.mockResolvedValue({ id: 'cus_123', deleted: true });

    const res = await request(createApp()).delete('/auth/delete-account');

    expect(res.status).toBe(200);
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockCustomersDel).toHaveBeenCalledWith('cus_123');
    expect(mockPrisma.user.delete).toHaveBeenCalled();
  });

  describe('when Stripe fails', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' });
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_123', status: 'active' });
    });

    it('blocks deletion and leaves all data intact when cancellation fails', async () => {
      mockSubscriptionsCancel.mockRejectedValue(Object.assign(new Error('Stripe is down'), { type: 'StripeAPIError' }));

      const res = await request(createApp()).delete('/auth/delete-account');

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('BILLING_CANCELLATION_FAILED');
      expect(res.body.error).toMatch(/has not been deleted/);
      expect(mockCustomersDel).not.toHaveBeenCalled();
      expect(mockPrisma.ride.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.bike.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('blocks deletion when deleting the Stripe customer fails', async () => {
      mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });
      mockCustomersDel.mockRejectedValue(Object.assign(new Error('Connection error'), { type: 'StripeConnectionError' }));

      const res = await request(createApp()).delete('/auth/delete-account');

      expect(res.status).toBe(503);
      expect(mockPrisma.ride.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
  });
});
