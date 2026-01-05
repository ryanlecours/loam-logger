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

jest.mock('../services/activation.service', () => ({
  activateWaitlistUser: jest.fn(),
  generateTempPassword: jest.fn(),
}));

jest.mock('../auth/password.utils', () => ({
  hashPassword: jest.fn(),
}));

jest.mock('../services/email.service', () => ({
  sendEmail: jest.fn(),
  sendEmailWithAudit: jest.fn(),
}));

jest.mock('../templates/emails', () => ({
  getActivationEmailSubject: jest.fn().mockReturnValue('Welcome!'),
  getActivationEmailHtml: jest.fn().mockReturnValue('<p>Welcome</p>'),
  getAnnouncementEmailHtml: jest.fn().mockReturnValue('<p>Announcement</p>'),
  ANNOUNCEMENT_TEMPLATE_VERSION: '1.0.0',
}));

jest.mock('../lib/unsubscribe-token', () => ({
  generateUnsubscribeToken: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../lib/html', () => ({
  escapeHtml: jest.fn((str) => str),
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
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
import { activateWaitlistUser } from '../services/activation.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCheckAdminRateLimit = checkAdminRateLimit as jest.MockedFunction<
  typeof checkAdminRateLimit
>;
const mockSendBadRequest = sendBadRequest as jest.MockedFunction<typeof sendBadRequest>;
const mockActivateWaitlistUser = activateWaitlistUser as jest.MockedFunction<
  typeof activateWaitlistUser
>;

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

describe('Admin Routes - ID Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('isValidId function (via bulk promote)', () => {
    const handler = findHandler('post', '/promote/bulk');

    it('should accept valid UUID format', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: ['550e8400-e29b-41d4-a716-446655440000'] };

      (mockPrisma.$transaction as jest.Mock).mockResolvedValue({
        promotedCount: 1,
        promotedEmails: ['test@example.com'],
      });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should accept valid CUID format', async () => {
      const { req, res } = createMocks();
      // CUID format: 'c' + 24 alphanumeric chars
      req.body = { userIds: ['clyj4kp8v0000qwerty123456'] };

      (mockPrisma.$transaction as jest.Mock).mockResolvedValue({
        promotedCount: 1,
        promotedEmails: ['test@example.com'],
      });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should reject SQL injection attempt in user ID', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: ["'; DROP TABLE users; --"] };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Invalid user ID format');
    });

    it('should reject malformed IDs', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: ['not-a-valid-id'] };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Invalid user ID format');
    });

    it('should reject empty strings', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: [''] };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Invalid user ID format');
    });

    it('should reject array with mixed valid and invalid IDs', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: ['550e8400-e29b-41d4-a716-446655440000', 'invalid-id'],
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Invalid user ID format');
    });
  });
});

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
});

describe('Admin Routes - Bulk Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('POST /promote/bulk', () => {
    const handler = findHandler('post', '/promote/bulk');

    it('should reject empty userIds array', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: [] };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'At least one user ID is required');
    });

    it('should reject non-array userIds', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: 'not-an-array' };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'At least one user ID is required');
    });

    it('should reject more than 100 users', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: Array.from({ length: 101 }, (_, i) =>
          `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`
        ),
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Cannot promote more than 100 users at once'
      );
    });

    it('should use transaction for atomicity', async () => {
      const { req, res } = createMocks();
      req.body = { userIds: ['550e8400-e29b-41d4-a716-446655440000'] };

      (mockPrisma.$transaction as jest.Mock).mockResolvedValue({
        promotedCount: 1,
        promotedEmails: ['test@example.com'],
      });

      await invokeHandler(handler, req, res);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('POST /email/send', () => {
    const handler = findHandler('post', '/email/send');

    it('should reject more than 500 recipients', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: Array.from({ length: 501 }, (_, i) => `user-${i}`),
        templateType: 'announcement',
        subject: 'Test',
        messageHtml: 'Test message',
      };

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(
        res,
        'Cannot send to more than 500 recipients at once'
      );
    });
  });
});

describe('Admin Routes - Rate Limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /activate/:userId', () => {
    const handler = findHandler('post', '/activate/:userId');

    it('should return 429 when rate limited', async () => {
      const { req, res } = createMocks();
      req.params = { userId: 'user-123' };

      mockCheckAdminRateLimit.mockResolvedValue({
        allowed: false,
        retryAfter: 10,
        redisAvailable: true,
      });

      await invokeHandler(handler, req, res);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too many activation attempts for this user',
          retryAfter: 10,
        })
      );
    });

    it('should proceed when rate limit allows', async () => {
      const { req, res } = createMocks();
      req.params = { userId: 'user-123' };

      mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
      mockActivateWaitlistUser.mockResolvedValue({ success: true, user: { id: 'user-123', email: 'test@example.com' } });

      await invokeHandler(handler, req, res);

      expect(mockActivateWaitlistUser).toHaveBeenCalled();
    });
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

  describe('POST /email/send', () => {
    const handler = findHandler('post', '/email/send');

    it('should apply rate limiting for bulk emails', async () => {
      const { req, res } = createMocks();
      req.body = {
        userIds: ['user-1'],
        templateType: 'announcement',
        subject: 'Test',
        messageHtml: 'Test',
      };

      mockCheckAdminRateLimit.mockResolvedValue({
        allowed: false,
        retryAfter: 60,
        redisAvailable: true,
      });

      await invokeHandler(handler, req, res);

      expect(mockCheckAdminRateLimit).toHaveBeenCalledWith('bulkEmail', 'admin-123');
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
  });
});

describe('Admin Routes - Self-Action Prevention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAdminRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('POST /users/:userId/demote', () => {
    const handler = findHandler('post', '/users/:userId/demote');

    it('should prevent self-demotion', async () => {
      const { req, res } = createMocks();
      req.params = { userId: 'admin-123' }; // Same as sessionUser.uid

      await invokeHandler(handler, req, res);

      expect(mockSendBadRequest).toHaveBeenCalledWith(res, 'Cannot demote your own account');
    });
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
      const handler = findHandler('post', '/activate/:userId');
      const { req, res } = createMocks();
      req.sessionUser = undefined;
      req.params = { userId: 'user-123' };

      await invokeHandler(handler, req, res);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
