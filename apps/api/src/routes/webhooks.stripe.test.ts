// Mock dependencies before imports
const mockConstructEvent = jest.fn();
jest.mock('../lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) },
  },
  STRIPE_CONFIG: { webhookSecret: 'whsec_test' },
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    bike: {
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    referral: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/email.service', () => ({
  sendEmailWithAudit: jest.fn().mockResolvedValue({ messageId: 'test', status: 'sent' }),
}));

jest.mock('../templates/emails/upgrade-confirmation', () => ({
  getUpgradeConfirmationEmailHtml: jest.fn().mockResolvedValue('<html></html>'),
  getUpgradeConfirmationEmailSubject: jest.fn().mockReturnValue('Subject'),
  UPGRADE_CONFIRMATION_TEMPLATE_VERSION: '1.0.0',
}));

jest.mock('../templates/emails/downgrade-notice', () => ({
  getDowngradeNoticeEmailHtml: jest.fn().mockResolvedValue('<html></html>'),
  getDowngradeNoticeEmailSubject: jest.fn().mockReturnValue('Subject'),
  DOWNGRADE_NOTICE_TEMPLATE_VERSION: '1.0.0',
}));

jest.mock('../templates/emails/payment-failed', () => ({
  getPaymentFailedEmailHtml: jest.fn().mockResolvedValue('<html></html>'),
  getPaymentFailedEmailSubject: jest.fn().mockReturnValue('Subject'),
  PAYMENT_FAILED_TEMPLATE_VERSION: '1.0.0',
}));

import express, { type Express } from 'express';
import request from 'supertest';
import stripeWebhooksRouter from './webhooks.stripe';
import { prisma } from '../lib/prisma';
import { sendEmailWithAudit } from '../services/email.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function createApp(): Express {
  const app = express();
  // Stripe webhooks need raw body
  app.use('/', express.raw({ type: 'application/json' }), stripeWebhooksRouter);
  return app;
}

function makeEvent(type: string, data: unknown) {
  return { id: 'evt_test', type, data: { object: data } };
}

describe('Stripe Webhooks', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signature verification', () => {
    it('should return 400 if signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'bad')
        .send('{}');

      expect(res.status).toBe(400);
    });
  });

  describe('checkout.session.completed', () => {
    const session = {
      id: 'cs_test',
      client_reference_id: 'user-1',
      subscription: 'sub_123',
      customer: 'cus_123',
    };

    beforeEach(() => {
      mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', session));
    });

    it('should upgrade user to PRO when preconditions match', async () => {
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          bike: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return fn(tx);
      });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'test@test.com', name: 'Test' });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(session));

      expect(res.status).toBe(200);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(sendEmailWithAudit).toHaveBeenCalled();
    });

    it('should skip if updateMany matches 0 rows (idempotent/founding rider)', async () => {
      const mockBikeUpdateMany = jest.fn();
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          bike: { updateMany: mockBikeUpdateMany },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(session));

      expect(res.status).toBe(200);
      expect(sendEmailWithAudit).not.toHaveBeenCalled();
      expect(mockBikeUpdateMany).not.toHaveBeenCalled();
    });

    it('should skip if subscription ID is missing', async () => {
      const noSub = { ...session, subscription: null };
      mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', noSub));

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(noSub));

      expect(res.status).toBe(200);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should skip if client_reference_id is missing', async () => {
      const noUser = { ...session, client_reference_id: null };
      mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', noUser));

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(noUser));

      expect(res.status).toBe(200);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.deleted', () => {
    const subscription = {
      id: 'sub_123',
      metadata: { userId: 'user-1' },
      customer: 'cus_123',
      status: 'canceled',
    };

    beforeEach(() => {
      mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));
    });

    it('should downgrade user to FREE_LIGHT when no referrals', async () => {
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({ isFoundingRider: false, subscriptionTier: 'PRO', email: 'test@test.com', name: 'Test' }),
            update: jest.fn().mockResolvedValue({}),
          },
          referral: { findFirst: jest.fn().mockResolvedValue(null) },
          bike: { count: jest.fn().mockResolvedValue(1) },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(res.status).toBe(200);
    });

    it('should downgrade to FREE_FULL when user has completed referral', async () => {
      let savedTier: string | undefined;
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({ isFoundingRider: false, subscriptionTier: 'PRO', email: 'test@test.com', name: 'Test' }),
            update: jest.fn().mockImplementation(({ data }: { data: { subscriptionTier: string } }) => {
              savedTier = data.subscriptionTier;
              return Promise.resolve({});
            }),
          },
          referral: { findFirst: jest.fn().mockResolvedValue({ id: 'ref-1' }) },
          bike: { count: jest.fn().mockResolvedValue(1) },
        };
        return fn(tx);
      });

      await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(savedTier).toBe('FREE_FULL');
    });

    it('should set needsDowngradeSelection when user has multiple bikes', async () => {
      let savedNeedsSelection: boolean | undefined;
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({ isFoundingRider: false, subscriptionTier: 'PRO', email: 'test@test.com', name: 'Test' }),
            update: jest.fn().mockImplementation(({ data }: { data: { needsDowngradeSelection: boolean } }) => {
              savedNeedsSelection = data.needsDowngradeSelection;
              return Promise.resolve({});
            }),
          },
          referral: { findFirst: jest.fn().mockResolvedValue(null) },
          bike: { count: jest.fn().mockResolvedValue(3) },
        };
        return fn(tx);
      });

      await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(savedNeedsSelection).toBe(true);
    });

    it('should skip for founding riders', async () => {
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({ isFoundingRider: true, subscriptionTier: 'PRO', email: 'test@test.com', name: 'Test' }),
            update: jest.fn(),
          },
          referral: { findFirst: jest.fn() },
          bike: { count: jest.fn() },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(res.status).toBe(200);
      expect(sendEmailWithAudit).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.updated', () => {
    const subscription = {
      id: 'sub_123',
      metadata: { userId: 'user-1' },
      customer: 'cus_123',
      status: 'active',
    };

    it('should re-upgrade user when subscription resumes (active after past_due)', async () => {
      mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
      (mockPrisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce({ isFoundingRider: false }) // initial check
        .mockResolvedValueOnce({ email: 'test@test.com', name: 'Test' }); // post-upgrade email fetch

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          bike: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(res.status).toBe(200);
      expect(sendEmailWithAudit).toHaveBeenCalled();
    });

    it('should not re-upgrade if user is already PRO', async () => {
      mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ isFoundingRider: false });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          bike: { updateMany: jest.fn() },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(res.status).toBe(200);
      expect(sendEmailWithAudit).not.toHaveBeenCalled();
    });

    it('should skip for founding riders', async () => {
      mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', subscription));
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ isFoundingRider: true });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(res.status).toBe(200);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should log warning for past_due status', async () => {
      const pastDueSub = { ...subscription, status: 'past_due' };
      mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.updated', pastDueSub));
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ isFoundingRider: false });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(pastDueSub));

      expect(res.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('should return 500 on transient errors so Stripe retries', async () => {
      mockConstructEvent.mockReturnValue(makeEvent('checkout.session.completed', {
        id: 'cs_test',
        client_reference_id: 'user-1',
        subscription: 'sub_123',
        customer: 'cus_123',
      }));
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send('{}');

      expect(res.status).toBe(500);
    });
  });

  describe('resolveUserId fallback', () => {
    it('should resolve user via stripeCustomerId when metadata is missing', async () => {
      const subscription = {
        id: 'sub_123',
        metadata: {},
        customer: 'cus_456',
        status: 'canceled',
      };
      mockConstructEvent.mockReturnValue(makeEvent('customer.subscription.deleted', subscription));

      // resolveUserId falls back to findUnique by stripeCustomerId
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-found' });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            findUnique: jest.fn().mockResolvedValue({ isFoundingRider: false, subscriptionTier: 'PRO', email: 'test@test.com', name: 'Test' }),
            update: jest.fn().mockResolvedValue({}),
          },
          referral: { findFirst: jest.fn().mockResolvedValue(null) },
          bike: { count: jest.fn().mockResolvedValue(1) },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/')
        .set('stripe-signature', 'valid')
        .send(JSON.stringify(subscription));

      expect(res.status).toBe(200);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_456' },
        select: { id: true },
      });
    });
  });
});
