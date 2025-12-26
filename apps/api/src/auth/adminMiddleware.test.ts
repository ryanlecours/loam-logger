import type { Request, Response, NextFunction } from 'express';

// Mock dependencies before importing
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../lib/api-response', () => ({
  sendUnauthorized: jest.fn(),
  sendForbidden: jest.fn(),
  sendInternalError: jest.fn(),
}));

import { requireAdmin } from './adminMiddleware';
import { prisma } from '../lib/prisma';
import { sendUnauthorized, sendForbidden, sendInternalError } from '../lib/api-response';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockSendUnauthorized = sendUnauthorized as jest.MockedFunction<typeof sendUnauthorized>;
const mockSendForbidden = sendForbidden as jest.MockedFunction<typeof sendForbidden>;
const mockSendInternalError = sendInternalError as jest.MockedFunction<typeof sendInternalError>;

describe('requireAdmin middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {};
    mockRes = {};
    mockNext = jest.fn();
  });

  it('should call sendUnauthorized when sessionUser is missing', async () => {
    mockReq.sessionUser = undefined;

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockSendUnauthorized).toHaveBeenCalledWith(mockRes);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call sendUnauthorized when sessionUser.uid is missing', async () => {
    mockReq.sessionUser = {} as never;

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockSendUnauthorized).toHaveBeenCalledWith(mockRes);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call sendForbidden when user is not found in database', async () => {
    mockReq.sessionUser = { uid: 'user123' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user123' },
      select: { role: true },
    });
    expect(mockSendForbidden).toHaveBeenCalledWith(mockRes, 'Admin access required', 'ADMIN_REQUIRED');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call sendForbidden when user role is FREE', async () => {
    mockReq.sessionUser = { uid: 'user123' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'FREE' });

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockSendForbidden).toHaveBeenCalledWith(mockRes, 'Admin access required', 'ADMIN_REQUIRED');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call sendForbidden when user role is PRO', async () => {
    mockReq.sessionUser = { uid: 'user123' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'PRO' });

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockSendForbidden).toHaveBeenCalledWith(mockRes, 'Admin access required', 'ADMIN_REQUIRED');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call sendForbidden when user role is WAITLIST', async () => {
    mockReq.sessionUser = { uid: 'user123' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'WAITLIST' });

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockSendForbidden).toHaveBeenCalledWith(mockRes, 'Admin access required', 'ADMIN_REQUIRED');
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next() when user role is ADMIN', async () => {
    mockReq.sessionUser = { uid: 'admin123' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'ADMIN' });

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockSendUnauthorized).not.toHaveBeenCalled();
    expect(mockSendForbidden).not.toHaveBeenCalled();
  });

  it('should call sendInternalError when database throws', async () => {
    mockReq.sessionUser = { uid: 'user123' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockSendInternalError).toHaveBeenCalledWith(mockRes);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should query database with correct user ID', async () => {
    mockReq.sessionUser = { uid: 'specific-user-id' } as never;
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'ADMIN' });

    await requireAdmin(mockReq as Request, mockRes as Response, mockNext);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'specific-user-id' },
      select: { role: true },
    });
  });
});
