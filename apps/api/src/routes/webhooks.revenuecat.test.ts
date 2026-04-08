import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockUpgradeUser = jest.fn().mockResolvedValue(true);
const mockDowngradeUser = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/subscription.service', () => ({
  upgradeUser: (...args: unknown[]) => mockUpgradeUser(...args),
  downgradeUser: (...args: unknown[]) => mockDowngradeUser(...args),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    emailSend: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/email.service', () => ({
  sendEmailWithAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../templates/emails/payment-failed', () => ({
  getPaymentFailedEmailHtml: jest.fn().mockResolvedValue('<html>Payment failed</html>'),
  getPaymentFailedEmailSubject: jest.fn().mockReturnValue('Payment Failed'),
  PAYMENT_FAILED_TEMPLATE_VERSION: '1.0',
}));

jest.mock('../config/env', () => ({
  config: { revenuecatWebhookAuthKey: 'test-webhook-key' },
}));

jest.mock('../lib/revenuecat', () => ({
  storeToProvider: jest.fn((store: string) => store === 'APP_STORE' ? 'APPLE' : 'GOOGLE'),
  validateRevenueCatConfig: jest.fn(),
}));

import router from './webhooks.revenuecat';
import { prisma } from '../lib/prisma';
import { sendEmailWithAudit } from '../services/email.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockSendEmailWithAudit = sendEmailWithAudit as jest.Mock;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getHandler(path: string, method: string): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === path && l.route?.methods?.[method]
  );
  const handlers = layer?.route?.stack;
  return handlers?.[handlers.length - 1]?.handle;
}

async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

function createWebhookRequest(eventType: string, overrides: Record<string, unknown> = {}) {
  return {
    headers: { authorization: 'Bearer test-webhook-key' },
    body: {
      event: {
        type: eventType,
        app_user_id: 'user-123',
        store: 'APP_STORE',
        ...overrides,
      },
    },
  } as unknown as Request;
}

describe('POST /webhooks/revenuecat', () => {
  let handler: RequestHandler | undefined;

  beforeAll(() => {
    handler = getHandler('/', 'post');
    if (!handler) throw new Error('Handler not found for /');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 for invalid authorization', async () => {
    const req = {
      headers: { authorization: 'Bearer wrong-key' },
      body: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-123' } },
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Unauthorized');
  });

  it('should return 400 for missing event', async () => {
    const req = {
      headers: { authorization: 'Bearer test-webhook-key' },
      body: {},
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should upgrade user on INITIAL_PURCHASE', async () => {
    const req = createWebhookRequest('INITIAL_PURCHASE');
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockUpgradeUser).toHaveBeenCalledWith('user-123', 'APPLE', 'revenuecat_webhook');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should upgrade user on RENEWAL', async () => {
    const req = createWebhookRequest('RENEWAL', { store: 'PLAY_STORE' });
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockUpgradeUser).toHaveBeenCalledWith('user-123', 'GOOGLE', 'revenuecat_webhook');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should downgrade user on EXPIRATION', async () => {
    const req = createWebhookRequest('EXPIRATION');
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockDowngradeUser).toHaveBeenCalledWith('user-123', 'revenuecat_webhook');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should not downgrade on CANCELLATION (access continues)', async () => {
    const req = createWebhookRequest('CANCELLATION');
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockDowngradeUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should handle missing app_user_id gracefully', async () => {
    const req = {
      headers: { authorization: 'Bearer test-webhook-key' },
      body: { event: { type: 'INITIAL_PURCHASE', store: 'APP_STORE' } },
    } as unknown as Request;
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockUpgradeUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 on handler error', async () => {
    mockUpgradeUser.mockRejectedValueOnce(new Error('DB connection failed'));
    const req = createWebhookRequest('INITIAL_PURCHASE');
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should upgrade user on UNCANCELLATION', async () => {
    const req = createWebhookRequest('UNCANCELLATION');
    const res = createMockResponse();

    await invokeHandler(handler, req, res as unknown as Response);

    expect(mockUpgradeUser).toHaveBeenCalledWith('user-123', 'APPLE', 'revenuecat_webhook');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe('BILLING_ISSUE', () => {
    it('should send payment failed email', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@test.com',
        name: 'Test User',
      });
      (mockPrisma.emailSend.findFirst as jest.Mock).mockResolvedValue(null);

      const req = createWebhookRequest('BILLING_ISSUE');
      const res = createMockResponse();

      await invokeHandler(handler, req, res as unknown as Response);

      expect(mockSendEmailWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@test.com',
          emailType: 'payment_failed',
          triggerSource: 'revenuecat_webhook',
          bypassUnsubscribe: true,
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should skip email if one was sent in last 24h', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@test.com',
        name: 'Test User',
      });
      (mockPrisma.emailSend.findFirst as jest.Mock).mockResolvedValue({ id: 'recent-email' });

      const req = createWebhookRequest('BILLING_ISSUE');
      const res = createMockResponse();

      await invokeHandler(handler, req, res as unknown as Response);

      expect(mockSendEmailWithAudit).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should handle unknown user gracefully', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const req = createWebhookRequest('BILLING_ISSUE');
      const res = createMockResponse();

      await invokeHandler(handler, req, res as unknown as Response);

      expect(mockSendEmailWithAudit).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
