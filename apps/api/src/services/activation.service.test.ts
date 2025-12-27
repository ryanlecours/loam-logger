import { generateTempPassword, activateWaitlistUser } from './activation.service';
import { validatePassword } from '@loam/shared';

// Mock dependencies
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../auth/password.utils', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed_password'),
}));

jest.mock('../lib/queue', () => ({
  addEmailJob: jest.fn().mockResolvedValue(true),
  scheduleWelcomeSeries: jest.fn().mockResolvedValue(undefined),
}));

// Import mocks
import { prisma } from '../lib/prisma';
import { hashPassword } from '../auth/password.utils';
import { addEmailJob, scheduleWelcomeSeries } from '../lib/queue';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockHashPassword = hashPassword as jest.MockedFunction<typeof hashPassword>;
const mockAddEmailJob = addEmailJob as jest.MockedFunction<typeof addEmailJob>;
const mockScheduleWelcomeSeries = scheduleWelcomeSeries as jest.MockedFunction<typeof scheduleWelcomeSeries>;

describe('generateTempPassword', () => {
  it('should generate a password that passes validation', () => {
    const password = generateTempPassword();
    const result = validatePassword(password);

    expect(result.isValid).toBe(true);
  });

  it('should generate passwords at least 8 characters long', () => {
    for (let i = 0; i < 10; i++) {
      const password = generateTempPassword();
      expect(password.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('should contain uppercase letters', () => {
    const password = generateTempPassword();
    expect(/[A-Z]/.test(password)).toBe(true);
  });

  it('should contain lowercase letters', () => {
    const password = generateTempPassword();
    expect(/[a-z]/.test(password)).toBe(true);
  });

  it('should contain numbers', () => {
    const password = generateTempPassword();
    expect(/[0-9]/.test(password)).toBe(true);
  });

  it('should contain special characters', () => {
    const password = generateTempPassword();
    expect(/[!@#$%^&*]/.test(password)).toBe(true);
  });

  it('should generate unique passwords on each call', () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 20; i++) {
      passwords.add(generateTempPassword());
    }
    // With 20 random passwords, we expect at least 15 unique ones
    expect(passwords.size).toBeGreaterThanOrEqual(15);
  });

  it('should match the expected format Word!Word#1234', () => {
    const password = generateTempPassword();
    // Should match pattern: CapitalizedWord + special + CapitalizedWord + special + 4digits
    expect(password).toMatch(/^[A-Z][a-z]+[!@#$%^&*][A-Z][a-z]+[!@#$%^&*]\d{4}$/);
  });
});

describe('activateWaitlistUser', () => {
  const mockUser = {
    id: 'user123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'WAITLIST' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAddEmailJob.mockResolvedValue(true);

    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (mockPrisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser, role: 'FREE' });
  });

  it('should throw error if user not found', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' })
    ).rejects.toThrow('User not found');
  });

  it('should throw error if user is not in WAITLIST state', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockUser,
      role: 'FREE',
    });

    await expect(
      activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' })
    ).rejects.toThrow('User is already activated (current role: FREE)');
  });

  it('should update user role to FREE', async () => {
    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user123' },
      data: expect.objectContaining({
        role: 'FREE',
        mustChangePassword: true,
        activatedBy: 'admin1',
      }),
    });
  });

  it('should set activatedAt timestamp', async () => {
    const beforeTest = new Date();

    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    const updateCall = (mockPrisma.user.update as jest.Mock).mock.calls[0][0];
    const activatedAt = updateCall.data.activatedAt;

    expect(activatedAt).toBeInstanceOf(Date);
    expect(activatedAt.getTime()).toBeGreaterThanOrEqual(beforeTest.getTime());
  });

  it('should hash the temporary password', async () => {
    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(mockHashPassword).toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: 'hashed_password',
        }),
      })
    );
  });

  it('should queue activation email', async () => {
    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(mockAddEmailJob).toHaveBeenCalledWith(
      'activation',
      expect.objectContaining({
        userId: 'user123',
        email: 'test@example.com',
        name: 'Test User',
      }),
      { jobId: 'activation-user123' }
    );
  });

  it('should schedule welcome series', async () => {
    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(mockScheduleWelcomeSeries).toHaveBeenCalledWith(
      'user123',
      'test@example.com',
      'Test User'
    );
  });

  it('should return success with emailQueued true when email succeeds', async () => {
    const result = await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(result).toEqual({
      success: true,
      userId: 'user123',
      email: 'test@example.com',
      emailQueued: true,
    });
    expect(result.tempPassword).toBeUndefined();
  });

  it('should return tempPassword when email queueing fails', async () => {
    mockAddEmailJob.mockRejectedValue(new Error('Redis connection failed'));

    const result = await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(result.success).toBe(true);
    expect(result.emailQueued).toBe(false);
    expect(result.tempPassword).toBeDefined();
    // Verify the temp password is valid
    expect(validatePassword(result.tempPassword!).isValid).toBe(true);
  });

  it('should still activate user even if email fails', async () => {
    mockAddEmailJob.mockRejectedValue(new Error('Redis connection failed'));

    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    // User should still be updated
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('should handle user without name', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...mockUser,
      name: null,
    });

    await activateWaitlistUser({ userId: 'user123', adminUserId: 'admin1' });

    expect(mockAddEmailJob).toHaveBeenCalledWith(
      'activation',
      expect.objectContaining({
        name: undefined,
      }),
      expect.any(Object)
    );

    expect(mockScheduleWelcomeSeries).toHaveBeenCalledWith(
      'user123',
      'test@example.com',
      undefined
    );
  });
});
