/**
 * Tests for admin route input validation, bulk operations, and security measures
 */

// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    emailSend: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    scheduledEmail: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../auth/adminMiddleware', () => ({
  requireAdmin: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../lib/rate-limit', () => ({
  checkAdminRateLimit: jest.fn(),
}));

jest.mock('../auth/password.utils', () => ({
  hashPassword: jest.fn(),
  validatePassword: jest.fn().mockReturnValue({ isValid: true }),
}));

jest.mock('../services/email.service', () => ({
  sendEmail: jest.fn(),
  sendEmailWithAudit: jest.fn(),
  sendReactEmailWithAudit: jest.fn().mockResolvedValue({ status: 'sent', messageId: 'mock-id' }),
}));

jest.mock('../templates/emails', () => ({
  getActivationEmailSubject: jest.fn().mockReturnValue('Welcome!'),
  getActivationEmailHtml: jest.fn().mockReturnValue('<p>Welcome</p>'),
  getAnnouncementEmailHtml: jest.fn().mockReturnValue('<p>Announcement</p>'),
  ANNOUNCEMENT_TEMPLATE_VERSION: '1.0.0',
  getTemplateListForAPI: jest.fn().mockReturnValue([]),
  getTemplateById: jest.fn(),
  buildTemplateProps: jest.fn().mockReturnValue({}),
}));

jest.mock('../lib/unsubscribe-token', () => ({
  generateUnsubscribeToken: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../lib/html', () => ({
  escapeHtml: jest.fn((str) => str),
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  createLogger: jest.fn(() => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() })),
}));

jest.mock('../lib/api-response', () => ({
  sendUnauthorized: jest.fn((res) => res.status(401).json({ error: 'Unauthorized' })),
  sendBadRequest: jest.fn((res, message) => res.status(400).json({ error: message })),
  sendInternalError: jest.fn((res, message) => res.status(500).json({ error: message })),
}));

import type { Request, Response, RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { sendBadRequest } from '../lib/api-response';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCheckAdminRateLimit = checkAdminRateLimit as jest.MockedFunction<
  typeof checkAdminRateLimit
>;
const mockSendBadRequest = sendBadRequest as jest.MockedFunction<typeof sendBadRequest>;

// Import router after mocks
import router from './admin';

// Type for Express router layer internals (used for test inspection)
interface RouteLayer {
  route?: {
    path: string;
    stack: Array<{ method: string; handle: RequestHandler }>;
  };
}

// Helper to find route handler by method and path
function findHandler(method: string, path: string): RequestHandler | null {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) =>
      l.route?.path === path &&
      l.route?.stack.some((s) => s.method === method.toLowerCase())
  );
  if (!layer?.route) return null;
  return layer.route.stack.find((s) => s.method === method.toLowerCase())?.handle ?? null;
}

// Helper to create mock request/response
function createMocks() {
  const req: Partial<Request> = {
    sessionUser: { uid: 'admin-123', email: 'admin@example.com' },
    params: {},
    query: {},
    body: {},
  };

  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };

  return { req: req as Request, res: res as Response };
}

// Helper to invoke route handler with proper signature
async function invokeHandler(
  handler: RequestHandler | null,
  req: Request,
  res: Response
): Promise<void> {
  if (!handler) throw new Error('Handler not found');
  await handler(req, res, jest.fn());
}

describe('Admin Routes - Email Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('POST /users (create user)', () => {
    const handler = findHandler('post', '/users');

    it('should reject email without @ symbol', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'invalid-email' };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Valid email is required');
    });

    it('should reject email without domain', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'user@' };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Valid email is required');
    });

    it('should reject email without TLD', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'user@domain' };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Valid email is required');
    });

    it('should reject email over 255 characters', async () => {
      const { req, res } = createMocks();
      const longEmail = 'a'.repeat(250) + '@example.com';
      req.body = { email: longEmail };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Valid email is required');
    });

    it('should reject email with spaces', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'user @example.com' };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Valid email is required');
    });

    it('should accept valid email', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'valid@example.com', role: 'FREE' };

      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.user.create as jest.Mock).mockResolvedValue({
        id: 'new-user-id',
        email: 'valid@example.com',
        name: null,
        role: 'FREE',
        createdAt: new Date(),
      });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should reject invalid role', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'valid@example.com', role: 'SUPERADMIN' };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        expect.stringContaining('Role must be one of')
      );
    });
  });
});

describe('Admin Routes - Subject Length Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('POST /email/schedule', () => {
    const handler = findHandler('post', '/email/schedule');

    it('should reject subject over 200 characters', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: ['550e8400-e29b-41d4-a716-446655440000'],
        templateType: 'announcement',
        subject: 'A'.repeat(201),
        messageHtml: 'Test message',
        scheduledFor: new Date(Date.now() + 3600000).toISOString(),
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Subject must be 200 characters or less'
      );
    });

    it('should accept subject at 200 characters', async () => {
      const { req, res } = createMocks();
      const validSubject = 'A'.repeat(200);
      req.body = {
        userIds: ['550e8400-e29b-41d4-a716-446655440000'],
        templateType: 'announcement',
        subject: validSubject,
        messageHtml: 'Test message',
        scheduledFor: new Date(Date.now() + 3600000).toISOString(),
      };

      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000' }]);
      (mockPrisma.scheduledEmail.create as jest.Mock).mockResolvedValue({
        id: 'scheduled-1',
        subject: validSubject,
        scheduledFor: new Date(),
        recipientCount: 1,
        status: 'pending',
      });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.scheduledEmail.create).toHaveBeenCalled();
    });
  });

  describe('POST /email/unified/send', () => {
    const handler = findHandler('post', '/email/unified/send');
    const RECIPIENT_ID = '550e8400-e29b-41d4-a716-446655440000';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTemplateById, buildTemplateProps } = require('../templates/emails');

    beforeEach(() => {
      (buildTemplateProps as jest.Mock).mockReturnValue({});
      (getTemplateById as jest.Mock).mockReturnValue({
        id: 'composer',
        displayName: 'Composer',
        defaultSubject: 'Default subject',
        emailType: 'custom',
        templateVersion: '1.0.0',
        parameters: [],
        render: jest.fn(),
      });
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: RECIPIENT_ID, email: 'rider@example.com', name: 'Rider', emailUnsubscribed: false },
      ]);
    });

    it('should reject subject over 200 characters on immediate sends', async () => {
      const { req, res } = createMocks();
      req.body = {
        templateId: 'composer',
        recipientIds: [RECIPIENT_ID],
        subject: 'A'.repeat(201),
        parameters: {},
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Subject must be 200 characters or less'
      );
    });

    it('should reject subject over 200 characters on scheduled sends', async () => {
      const { req, res } = createMocks();
      req.body = {
        templateId: 'composer',
        recipientIds: [RECIPIENT_ID],
        subject: 'A'.repeat(201),
        parameters: {},
        scheduledFor: new Date(Date.now() + 3600000).toISOString(),
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Subject must be 200 characters or less'
      );
      expect(mockPrisma.scheduledEmail.create).not.toHaveBeenCalled();
    });

    it('should accept subject at 200 characters on immediate sends', async () => {
      const { req, res } = createMocks();
      req.body = {
        templateId: 'composer',
        recipientIds: [RECIPIENT_ID],
        subject: 'A'.repeat(200),
        parameters: {},
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should trim the subject on immediate sends', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendReactEmailWithAudit } = require('../services/email.service');
      const { req, res } = createMocks();
      req.body = {
        templateId: 'composer',
        recipientIds: [RECIPIENT_ID],
        subject: '  Big update  ',
        parameters: {},
      };

      await invokeHandler(handler, req, res);

      expect(sendReactEmailWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Big update' })
      );
    });

    it('should reject non-string optional parameters with a clean error', async () => {
      (getTemplateById as jest.Mock).mockReturnValue({
        id: 'composer',
        displayName: 'Composer',
        defaultSubject: 'Default subject',
        emailType: 'custom',
        templateVersion: '1.0.0',
        parameters: [
          { key: 'header', label: 'Header', type: 'text', required: true },
          { key: 'previewText', label: 'Preview Text', type: 'text', required: false },
        ],
        render: jest.fn(),
      });
      (buildTemplateProps as jest.Mock).mockReturnValue({
        header: 'H',
        previewText: 12345,
      });

      const { req, res } = createMocks();
      req.body = {
        templateId: 'composer',
        recipientIds: [RECIPIENT_ID],
        subject: 'Subject',
        parameters: { header: 'H', previewText: 12345 },
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Preview Text must be a string');
    });
  });
});

describe('Admin Routes - Rate Limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /users (create user)', () => {
    const handler = findHandler('post', '/users');

    it('should apply rate limiting per admin', async () => {
      const { req, res } = createMocks();
      req.body = { email: 'new@example.com' };

      mockCheckAdminRateLimit.mockResolvedValue({
        allowed: false,
        retryAfter: 5,
        redisAvailable: true,
      });

      await invokeHandler(handler, req, res);

      expect(mockCheckAdminRateLimit).toHaveBeenCalledWith('createUser', 'admin-123');
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

});

describe('Admin Routes - Schedule Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('POST /email/schedule', () => {
    const handler = findHandler('post', '/email/schedule');

    it('should reject past scheduled time', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: ['550e8400-e29b-41d4-a716-446655440000'],
        templateType: 'announcement',
        subject: 'Test',
        messageHtml: 'Test message',
        scheduledFor: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Scheduled time must be in the future');
    });

    it('should reject invalid date format', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: ['550e8400-e29b-41d4-a716-446655440000'],
        templateType: 'announcement',
        subject: 'Test',
        messageHtml: 'Test message',
        scheduledFor: 'not-a-date',
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Invalid scheduled time format');
    });

    it('should accept valid future date', async () => {
      const { req, res } = createMocks();
      const futureDate = new Date(Date.now() + 3600000);
      req.body = {
        userIds: ['550e8400-e29b-41d4-a716-446655440000'],
        templateType: 'announcement',
        subject: 'Test',
        messageHtml: 'Test message',
        scheduledFor: futureDate.toISOString(),
      };

      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000' }]);
      (mockPrisma.scheduledEmail.create as jest.Mock).mockResolvedValue({
        id: 'scheduled-1',
        subject: 'Test',
        scheduledFor: futureDate,
        recipientCount: 1,
        status: 'pending',
      });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.scheduledEmail.create).toHaveBeenCalled();
    });
  });

  describe('PUT /email/scheduled/:id', () => {
    const handler = findHandler('put', '/email/scheduled/:id');

    it('should only update pending emails (atomic)', async () => {
      const { req, res } = createMocks();
      req.params = { id: 'scheduled-1' };
      req.body = { subject: 'Updated subject' };

      // Simulate updateMany returning 0 (not pending)
      (mockPrisma.scheduledEmail.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (mockPrisma.scheduledEmail.findUnique as jest.Mock).mockResolvedValue({
        status: 'processing',
      });

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Cannot edit scheduled email with status: processing'
      );
    });

    it('should succeed for pending emails', async () => {
      const { req, res } = createMocks();
      req.params = { id: 'scheduled-1' };
      req.body = { subject: 'Updated subject' };

      (mockPrisma.scheduledEmail.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (mockPrisma.scheduledEmail.findUnique as jest.Mock).mockResolvedValue({
        id: 'scheduled-1',
        subject: 'Updated subject',
        scheduledFor: new Date(),
        recipientCount: 1,
        status: 'pending',
      });

      await invokeHandler(handler, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('should reject messageHtml edits on unified: rows (JSON would be corrupted)', async () => {
      const { req, res } = createMocks();
      req.params = { id: 'scheduled-1' };
      req.body = { messageHtml: 'new body text' };

      (mockPrisma.scheduledEmail.findUnique as jest.Mock).mockResolvedValue({
        templateType: 'unified:composer',
        status: 'pending',
      });

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Cannot edit the message body of a template-based scheduled email. Cancel it and schedule a new one from the compose form.'
      );
      expect(mockPrisma.scheduledEmail.updateMany).not.toHaveBeenCalled();
    });

    it('should report the real status when editing the body of a sent unified row', async () => {
      const { req, res } = createMocks();
      req.params = { id: 'scheduled-1' };
      req.body = { messageHtml: 'new body text' };

      (mockPrisma.scheduledEmail.findUnique as jest.Mock).mockResolvedValue({
        templateType: 'unified:composer',
        status: 'sent',
      });

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Cannot edit scheduled email with status: sent'
      );
      expect(mockPrisma.scheduledEmail.updateMany).not.toHaveBeenCalled();
    });

    it('should still allow messageHtml edits on legacy rows', async () => {
      const { req, res } = createMocks();
      req.params = { id: 'scheduled-1' };
      req.body = { messageHtml: 'new body text' };

      // First findUnique: templateType guard; second: response fetch
      (mockPrisma.scheduledEmail.findUnique as jest.Mock)
        .mockResolvedValueOnce({ templateType: 'announcement', status: 'pending' })
        .mockResolvedValueOnce({
          id: 'scheduled-1',
          subject: 'Subject',
          scheduledFor: new Date(),
          recipientCount: 1,
          status: 'pending',
        });
      (mockPrisma.scheduledEmail.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.scheduledEmail.updateMany).toHaveBeenCalledWith({
        where: { id: 'scheduled-1', status: 'pending' },
        data: expect.objectContaining({ messageHtml: expect.any(String) }),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });
});

describe('Admin Routes - Self-Action Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('DELETE /users/:userId', () => {
    const handler = findHandler('delete', '/users/:userId');

    it('should prevent self-deletion', async () => {
      const { req, res } = createMocks();
      req.params = { userId: 'admin-123' }; // Same as sessionUser.uid

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Cannot delete your own account');
    });
  });
});

describe('Admin Routes - Authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('All endpoints', () => {
    it('should require admin session', async () => {
      const handler = findHandler('post', '/users');
      const { req, res } = createMocks();
      req.sessionUser = undefined;
      req.body = { email: 'new@example.com' };

      await invokeHandler(handler, req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
