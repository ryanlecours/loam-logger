import type { Request, Response, RequestHandler } from 'express';

// Mock Prisma
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock unsubscribe token
jest.mock('../lib/unsubscribe-token', () => ({
  verifyUnsubscribeToken: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { verifyUnsubscribeToken } from '../lib/unsubscribe-token';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockVerifyUnsubscribeToken = verifyUnsubscribeToken as jest.MockedFunction<
  typeof verifyUnsubscribeToken
>;

// Import the router after mocks are set up
import router from './email.unsubscribe';

// Type for Express router layer internals
interface RouteLayer {
  route?: {
    path: string;
    stack: Array<{ handle: RequestHandler }>;
  };
}

// Helper to get the route handler
function getHandler(): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find((l) => l.route?.path === '/email/unsubscribe');
  return layer?.route?.stack[0]?.handle;
}

// Helper to invoke handler with proper signature
async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn());
}

describe('GET /api/email/unsubscribe', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler();

    mockReq = {
      query: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe('Token Validation', () => {
    it('should return 400 when token is missing', async () => {
      mockReq.query = {};

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Missing or invalid token'));
    });

    it('should return 400 when token is empty string', async () => {
      mockReq.query = { token: '' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Missing or invalid token'));
    });

    it('should return 400 when token is not a string', async () => {
      mockReq.query = { token: ['array', 'of', 'tokens'] };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when token verification fails', async () => {
      mockReq.query = { token: 'invalid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockVerifyUnsubscribeToken).toHaveBeenCalledWith('invalid-token');
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid or expired unsubscribe link')
      );
    });
  });

  describe('Idempotency', () => {
    it('should return 200 success when user is already unsubscribed', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailUnsubscribed: true,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining("You've been unsubscribed"));
      // Should NOT try to update since already unsubscribed
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should return 200 success when user has been deleted', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'deleted-user' });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining("You've been unsubscribed"));
    });
  });

  describe('Successful Unsubscribe', () => {
    it('should unsubscribe user and return success page', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailUnsubscribed: false,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { emailUnsubscribed: true },
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining("You've been unsubscribed"));
    });

    it('should return HTML success page with correct branding', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailUnsubscribed: false,
      });
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({});

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const responseHtml = (mockRes.send as jest.Mock).mock.calls[0][0];
      expect(responseHtml).toContain('Loam Logger');
      expect(responseHtml).toContain('<!DOCTYPE html>');
    });
  });

  describe('Error Handling', () => {
    it('should return 500 when database error occurs', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });
      (mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('Database error'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('Something went wrong')
      );
    });

    it('should return 500 when update fails', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailUnsubscribed: false,
      });
      (mockPrisma.user.update as jest.Mock).mockRejectedValue(new Error('Update failed'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should escape HTML in error messages', async () => {
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });
      (mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(
        new Error('<script>alert("xss")</script>')
      );

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      const responseHtml = (mockRes.send as jest.Mock).mock.calls[0][0];
      // The error message should be generic, not include the actual error
      expect(responseHtml).not.toContain('<script>');
      expect(responseHtml).toContain('Something went wrong');
    });
  });

  describe('Security', () => {
    it('should not leak user existence through timing', async () => {
      // Both existing and non-existing users should return same response type
      mockReq.query = { token: 'valid-token' };
      mockVerifyUnsubscribeToken.mockReturnValue({ userId: 'user-123' });

      // Test with existing user
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        emailUnsubscribed: true,
      });

      await invokeHandler(handler, mockReq as Request, mockRes as Response);
      const existingUserStatus = (mockRes.status as jest.Mock).mock.calls[0][0];

      jest.clearAllMocks();

      // Test with non-existing user
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await invokeHandler(handler, mockReq as Request, mockRes as Response);
      const nonExistingUserStatus = (mockRes.status as jest.Mock).mock.calls[0][0];

      // Both should return 200 to avoid user enumeration
      expect(existingUserStatus).toBe(200);
      expect(nonExistingUserStatus).toBe(200);
    });
  });
});
