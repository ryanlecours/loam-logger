// Mock dependencies BEFORE importing the service
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

jest.mock('./email.service', () => ({
  sendEmailWithAudit: jest.fn(),
}));

jest.mock('../lib/posthog', () => ({
  captureServerEvent: jest.fn(),
}));

jest.mock('../lib/garmin-token', () => ({
  revokeGarminTokenForUser: jest.fn().mockResolvedValue(true),
}));

import { deleteUserAccount, BillingCancellationError } from './account-deletion.service';
import { prisma } from '../lib/prisma';
import { revokeStravaTokenForUser } from '../lib/strava-token';
import { revokeGarminTokenForUser } from '../lib/garmin-token';
import { sendEmailWithAudit } from './email.service';
import { captureServerEvent } from '../lib/posthog';
import { logger } from '../lib/logger';

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

const tx = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  bike: { count: jest.fn() },
};

function stripeError(code: string, message = 'Stripe error') {
  return Object.assign(new Error(message), { type: 'StripeInvalidRequestError', code });
}

describe('deleteUserAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null, stripeSubscriptionId: null });
    mockPrisma.user.delete.mockResolvedValue({ id: 'user-1', email: 'rider@example.com' });
    mockPrisma.ride.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.component.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.bike.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.userAccount.deleteMany.mockResolvedValue({ count: 0 });
    // Interactive form: the local Stripe clear. Array form: the OAuth teardown.
    tx.user.findUnique.mockResolvedValue({ isFoundingRider: false, subscriptionTier: 'PRO', subscriptionProvider: 'STRIPE' });
    tx.user.update.mockResolvedValue({});
    tx.bike.count.mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.resolve([])
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes all user data and returns the deleted email', async () => {
    const result = await deleteUserAccount('user-1');

    expect(result).toEqual({ email: 'rider@example.com' });
    expect(mockPrisma.ride.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockPrisma.component.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockPrisma.bike.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(revokeStravaTokenForUser).toHaveBeenCalledWith('user-1');
    expect(revokeGarminTokenForUser).toHaveBeenCalledWith('user-1');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.userAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('logs the user id but never the email', async () => {
    const consoleLog = jest.spyOn(console, 'log');

    await deleteUserAccount('user-1');

    const logCalls = [
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
      ...(logger.error as jest.Mock).mock.calls,
    ];
    expect(logCalls).toContainEqual([{ userId: 'user-1' }, 'Account deletion: deleted user']);
    expect(JSON.stringify(logCalls)).not.toContain('rider@example.com');
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('continues when Strava/Garmin token revocation fails', async () => {
    (revokeStravaTokenForUser as jest.Mock).mockResolvedValueOnce(false);
    (revokeGarminTokenForUser as jest.Mock).mockResolvedValueOnce(false);

    await deleteUserAccount('user-1');

    expect(mockPrisma.user.delete).toHaveBeenCalled();
  });

  describe('web subscriber with an active Stripe subscription', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' });
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_123', status: 'active' });
      mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });
      mockCustomersDel.mockResolvedValue({ id: 'cus_123', deleted: true });
    });

    it('cancels the subscription and deletes the customer before deleting any data', async () => {
      await deleteUserAccount('user-1');

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

      await deleteUserAccount('user-1');

      expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
      expect(mockCustomersDel).toHaveBeenCalledWith('cus_123');
      expect(mockPrisma.user.delete).toHaveBeenCalled();
    });

    it('treats a subscription or customer Stripe no longer knows about as already done', async () => {
      mockSubscriptionsRetrieve.mockRejectedValue(stripeError('resource_missing', 'No such subscription'));
      mockCustomersDel.mockRejectedValue(stripeError('resource_missing', 'No such customer'));

      await deleteUserAccount('user-1');

      expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).toHaveBeenCalled();
    });
  });

  it('makes no Stripe calls for a user with no Stripe ids', async () => {
    await deleteUserAccount('user-1');

    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockCustomersDel).not.toHaveBeenCalled();
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('deletes the customer when there is no recorded subscription (former subscriber)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: null });
    mockCustomersDel.mockResolvedValue({ id: 'cus_123', deleted: true });

    await deleteUserAccount('user-1');

    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockCustomersDel).toHaveBeenCalledWith('cus_123');
    expect(mockPrisma.user.delete).toHaveBeenCalled();
  });

  describe('when Stripe fails', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' });
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_123', status: 'active' });
    });

    function expectNothingDeleted() {
      expect(mockPrisma.ride.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.component.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.bike.deleteMany).not.toHaveBeenCalled();
      expect(revokeStravaTokenForUser).not.toHaveBeenCalled();
      expect(mockPrisma.oauthToken.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.userIntegration.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.userAccount.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    }

    it('throws BillingCancellationError and changes nothing when cancellation fails', async () => {
      const cause = Object.assign(new Error('Stripe is down'), { type: 'StripeAPIError' });
      mockSubscriptionsCancel.mockRejectedValue(cause);

      const promise = deleteUserAccount('user-1');

      await expect(promise).rejects.toBeInstanceOf(BillingCancellationError);
      await expect(promise).rejects.toMatchObject({ cause });
      expect(mockCustomersDel).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
      expectNothingDeleted();
    });

    it('throws BillingCancellationError after recording the cancelled subscription when deleting the customer fails', async () => {
      mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });
      mockCustomersDel.mockRejectedValue(Object.assign(new Error('Connection error'), { type: 'StripeConnectionError' }));

      await expect(deleteUserAccount('user-1')).rejects.toBeInstanceOf(BillingCancellationError);

      // The subscription is gone in Stripe, so the row reflects that; the
      // customer still exists, so its id is kept for the retry.
      expect(tx.user.update).toHaveBeenCalledTimes(1);
      expect(tx.user.update.mock.calls[0][0].data).not.toHaveProperty('stripeCustomerId');
      expect(tx.user.update.mock.calls[0][0].data).toMatchObject({ stripeSubscriptionId: null, subscriptionTier: 'FREE' });
      expectNothingDeleted();
    });
  });

  describe('local billing state once Stripe billing stops', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' });
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_123', status: 'active' });
      mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });
      mockCustomersDel.mockResolvedValue({ id: 'cus_123', deleted: true });
    });

    it('leaves the row FREE with Stripe ids cleared, and sends nothing, when a later delete throws', async () => {
      const dbError = new Error('DB connection lost');
      mockPrisma.ride.deleteMany.mockRejectedValue(dbError);

      await expect(deleteUserAccount('user-1')).rejects.toBe(dbError);

      expect(tx.user.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1' },
        data: {
          stripeSubscriptionId: null,
          subscriptionProvider: null,
          subscriptionTier: 'FREE',
          needsDowngradeSelection: false,
        },
      });
      expect(tx.user.update).toHaveBeenLastCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ stripeCustomerId: null, stripeSubscriptionId: null }),
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
      expect(sendEmailWithAudit).not.toHaveBeenCalled();
      expect(captureServerEvent).not.toHaveBeenCalled();
    });

    it('flags bike selection when the downgraded rider has more than one active bike', async () => {
      tx.bike.count.mockResolvedValue(3);

      await deleteUserAccount('user-1');

      expect(tx.user.update.mock.calls[0][0].data).toMatchObject({ subscriptionTier: 'FREE', needsDowngradeSelection: true });
    });

    it('keeps the tier of a rider who is PRO through the App Store, clearing only stale Stripe ids', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: 'cus_old', stripeSubscriptionId: null });
      tx.user.findUnique.mockResolvedValue({ isFoundingRider: false, subscriptionTier: 'PRO', subscriptionProvider: 'APPLE' });

      await deleteUserAccount('user-1');

      expect(tx.user.update).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { stripeSubscriptionId: null, stripeCustomerId: null },
      });
      expect(tx.bike.count).not.toHaveBeenCalled();
    });

    it('keeps a founding rider PRO while clearing the Stripe provider and ids', async () => {
      tx.user.findUnique.mockResolvedValue({ isFoundingRider: true, subscriptionTier: 'PRO', subscriptionProvider: 'STRIPE' });

      await deleteUserAccount('user-1');

      for (const [call] of tx.user.update.mock.calls) {
        expect(call.data).not.toHaveProperty('subscriptionTier');
        expect(call.data).toMatchObject({ stripeSubscriptionId: null, subscriptionProvider: null });
      }
    });

    it('does not touch the row for a user with no Stripe ids', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ stripeCustomerId: null, stripeSubscriptionId: null });

      await deleteUserAccount('user-1');

      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });
});
