// Mock redis before importing
jest.mock('../lib/redis', () => ({
  isRedisReady: jest.fn(),
  getRedisConnection: jest.fn(),
}));

// Mock Prisma
jest.mock('../lib/prisma', () => ({
  prisma: {
    scheduledEmail: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Mock email service
jest.mock('./email.service', () => ({
  sendEmailWithAudit: jest.fn(),
}));

// Mock email templates
jest.mock('../templates/emails/announcement', () => ({
  getAnnouncementEmailHtml: jest.fn().mockResolvedValue('<p>Test Email</p>'),
  ANNOUNCEMENT_TEMPLATE_VERSION: '1.0.0',
}));

// Mock unsubscribe token
jest.mock('../lib/unsubscribe-token', () => ({
  generateUnsubscribeToken: jest.fn().mockReturnValue('mock-unsubscribe-token'),
}));

import { isRedisReady, getRedisConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { sendEmailWithAudit } from './email.service';

const mockIsRedisReady = isRedisReady as jest.MockedFunction<typeof isRedisReady>;
const mockGetRedisConnection = getRedisConnection as jest.MockedFunction<typeof getRedisConnection>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockSendEmailWithAudit = sendEmailWithAudit as jest.MockedFunction<typeof sendEmailWithAudit>;

// We need to import the module dynamically to test internal functions
// For now we'll test via the exported functions
import { startEmailScheduler, stopEmailScheduler } from './email-scheduler.service';

// The service has a 1100ms delay between emails to respect rate limits
// Tests need to advance timers by (numRecipients - 1) * 1100ms to process all emails
const EMAIL_DELAY_MS = 1100;

describe('Email Scheduler - Distributed Locking', () => {
  let mockRedis: {
    set: jest.Mock;
    eval: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockRedis = {
      set: jest.fn(),
      eval: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('acquireSchedulerLock', () => {
    it('should acquire lock when Redis is available and lock is free', async () => {
      mockIsRedisReady.mockReturnValue(true);
      mockRedis.set.mockResolvedValue('OK');
      (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

      startEmailScheduler();
      // Run immediate check
      await jest.advanceTimersByTimeAsync(0);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:email-scheduler:global',
        expect.any(String),
        'EX',
        120, // SCHEDULER_LOCK_TTL_SECONDS
        'NX'
      );

      await stopEmailScheduler();
    });

    it('should proceed without lock when Redis is unavailable', async () => {
      mockIsRedisReady.mockReturnValue(false);
      (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

      startEmailScheduler();
      await jest.advanceTimersByTimeAsync(0);

      // Should still check for due emails even without Redis
      expect(mockPrisma.scheduledEmail.findMany).toHaveBeenCalled();

      await stopEmailScheduler();
    });

    it('should skip processing when another instance holds the lock', async () => {
      mockIsRedisReady.mockReturnValue(true);
      mockRedis.set.mockResolvedValue(null); // Lock not acquired

      startEmailScheduler();
      await jest.advanceTimersByTimeAsync(0);

      // Should not attempt to find due emails
      expect(mockPrisma.scheduledEmail.findMany).not.toHaveBeenCalled();

      await stopEmailScheduler();
    });

    it('should release lock after processing', async () => {
      mockIsRedisReady.mockReturnValue(true);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.eval.mockResolvedValue(1);
      (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

      startEmailScheduler();
      await jest.advanceTimersByTimeAsync(0);

      // Should have released the lock using Lua script
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1])'),
        1,
        'lock:email-scheduler:global',
        expect.any(String)
      );

      await stopEmailScheduler();
    });
  });
});

describe('Email Scheduler - Status Transitions', () => {
  let mockRedis: {
    set: jest.Mock;
    eval: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockRedis = {
      set: jest.fn(),
      eval: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
    mockIsRedisReady.mockReturnValue(false); // Disable distributed lock for these tests
  });

  afterEach(async () => {
    jest.useRealTimers();
    await stopEmailScheduler();
  });

  it('should atomically claim email with status pending', async () => {
    const scheduledEmail = {
      id: 'email-123',
      subject: 'Test Subject',
      messageHtml: '<p>Test</p>',
      templateType: 'announcement',
      recipientIds: ['user-1'],
      status: 'processing',
    };

    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(scheduledEmail);
    (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'user-1', email: 'test@example.com', name: 'Test User', emailUnsubscribed: false },
    ]);
    mockSendEmailWithAudit.mockResolvedValue({ status: 'sent' });
    (mockPrisma.scheduledEmail.update as jest.Mock).mockResolvedValue({});

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    // Should use transaction for atomic claim + fetch
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('should skip email if already claimed by another instance', async () => {
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(null); // Already claimed

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    // Should not try to send emails
    expect(mockSendEmailWithAudit).not.toHaveBeenCalled();
  });

  it('should update status to sent when all emails succeed', async () => {
    const scheduledEmail = {
      id: 'email-123',
      subject: 'Test Subject',
      messageHtml: '<p>Test</p>',
      templateType: 'announcement',
      recipientIds: ['user-1', 'user-2'],
      status: 'processing',
    };

    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(scheduledEmail);
    (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'user-1', email: 'user1@example.com', name: 'User 1', emailUnsubscribed: false },
      { id: 'user-2', email: 'user2@example.com', name: 'User 2', emailUnsubscribed: false },
    ]);
    mockSendEmailWithAudit.mockResolvedValue({ status: 'sent' });
    (mockPrisma.scheduledEmail.update as jest.Mock).mockResolvedValue({});

    startEmailScheduler();
    // Advance by enough time for the delay between 2 emails
    await jest.advanceTimersByTimeAsync(EMAIL_DELAY_MS);

    expect(mockPrisma.scheduledEmail.update).toHaveBeenCalledWith({
      where: { id: 'email-123' },
      data: expect.objectContaining({
        status: 'sent',
        sentCount: 2,
        failedCount: 0,
      }),
    });
  });

  it('should update status to failed when all emails fail', async () => {
    const scheduledEmail = {
      id: 'email-123',
      subject: 'Test Subject',
      messageHtml: '<p>Test</p>',
      templateType: 'announcement',
      recipientIds: ['user-1'],
      status: 'processing',
    };

    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(scheduledEmail);
    (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'user-1', email: 'user1@example.com', name: 'User 1', emailUnsubscribed: false },
    ]);
    mockSendEmailWithAudit.mockRejectedValue(new Error('Send failed'));
    (mockPrisma.scheduledEmail.update as jest.Mock).mockResolvedValue({});

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockPrisma.scheduledEmail.update).toHaveBeenCalledWith({
      where: { id: 'email-123' },
      data: expect.objectContaining({
        status: 'failed',
        failedCount: 1,
      }),
    });
  });

  it('should mark as failed when no recipients', async () => {
    const scheduledEmail = {
      id: 'email-123',
      subject: 'Test Subject',
      messageHtml: '<p>Test</p>',
      templateType: 'announcement',
      recipientIds: [],
      status: 'processing',
    };

    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(scheduledEmail);
    (mockPrisma.scheduledEmail.update as jest.Mock).mockResolvedValue({});

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockPrisma.scheduledEmail.update).toHaveBeenCalledWith({
      where: { id: 'email-123' },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: 'No recipients specified',
      }),
    });
  });
});

describe('Email Scheduler - Batch Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsRedisReady.mockReturnValue(false);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await stopEmailScheduler();
  });

  it('should process recipients in batches of 50', async () => {
    // Create 120 recipient IDs to test batching
    const recipientIds = Array.from({ length: 120 }, (_, i) => `user-${i}`);

    const scheduledEmail = {
      id: 'email-123',
      subject: 'Test Subject',
      messageHtml: '<p>Test</p>',
      templateType: 'announcement',
      recipientIds,
      status: 'processing',
    };

    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(scheduledEmail);

    // Mock findMany to return users for each batch
    (mockPrisma.user.findMany as jest.Mock).mockImplementation(({ where }) => {
      return Promise.resolve(
        where.id.in.map((id: string) => ({
          id,
          email: `${id}@example.com`,
          name: id,
          emailUnsubscribed: false,
        }))
      );
    });

    mockSendEmailWithAudit.mockResolvedValue({ status: 'sent' });
    (mockPrisma.scheduledEmail.update as jest.Mock).mockResolvedValue({});

    startEmailScheduler();
    // Advance by enough time for delays between 120 emails (119 delays)
    // Each batch has (batchSize - 1) delays, so: 49 + 49 + 19 = 117 delays total
    // But the delay is between emails within a batch, not between batches
    // So we need: (50-1) + (50-1) + (20-1) = 117 delays
    await jest.advanceTimersByTimeAsync(117 * EMAIL_DELAY_MS);

    // Should have called findMany 3 times (50 + 50 + 20)
    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(3);

    // First batch: 50 users
    expect((mockPrisma.user.findMany as jest.Mock).mock.calls[0][0].where.id.in).toHaveLength(50);
    // Second batch: 50 users
    expect((mockPrisma.user.findMany as jest.Mock).mock.calls[1][0].where.id.in).toHaveLength(50);
    // Third batch: 20 users
    expect((mockPrisma.user.findMany as jest.Mock).mock.calls[2][0].where.id.in).toHaveLength(20);
  });

  it('should track results across all batches', async () => {
    const recipientIds = Array.from({ length: 60 }, (_, i) => `user-${i}`);

    const scheduledEmail = {
      id: 'email-123',
      subject: 'Test Subject',
      messageHtml: '<p>Test</p>',
      templateType: 'announcement',
      recipientIds,
      status: 'processing',
    };

    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([{ id: 'email-123' }]);
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(scheduledEmail);
    (mockPrisma.user.findMany as jest.Mock).mockImplementation(({ where }) => {
      return Promise.resolve(
        where.id.in.map((id: string) => ({
          id,
          email: `${id}@example.com`,
          name: id,
          emailUnsubscribed: false,
        }))
      );
    });
    mockSendEmailWithAudit.mockResolvedValue({ status: 'sent' });
    (mockPrisma.scheduledEmail.update as jest.Mock).mockResolvedValue({});

    startEmailScheduler();
    // Advance by enough time for delays between 60 emails
    // 2 batches: (50-1) + (10-1) = 58 delays
    await jest.advanceTimersByTimeAsync(58 * EMAIL_DELAY_MS);

    // Should have sent 60 emails total
    expect(mockSendEmailWithAudit).toHaveBeenCalledTimes(60);

    // Final update should have 60 sent
    expect(mockPrisma.scheduledEmail.update).toHaveBeenCalledWith({
      where: { id: 'email-123' },
      data: expect.objectContaining({
        sentCount: 60,
      }),
    });
  });
});

describe('Email Scheduler - Graceful Shutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsRedisReady.mockReturnValue(false);
  });

  afterEach(async () => {
    jest.useRealTimers();
  });

  it('should stop scheduler cleanly when not processing', async () => {
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    // Should stop without waiting
    await stopEmailScheduler();

    // Verify interval is cleared by checking no more processing happens
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockClear();
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockPrisma.scheduledEmail.findMany).not.toHaveBeenCalled();
  });

  it('should not start if already running', async () => {
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    const consoleSpy = jest.spyOn(console, 'log');
    startEmailScheduler(); // Try to start again

    expect(consoleSpy).toHaveBeenCalledWith('[EmailScheduler] Already running');

    await stopEmailScheduler();
    consoleSpy.mockRestore();
  });
});

describe('Email Scheduler - Due Email Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsRedisReady.mockReturnValue(false);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await stopEmailScheduler();
  });

  it('should only process pending emails that are due', async () => {
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockPrisma.scheduledEmail.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        scheduledFor: { lte: expect.any(Date) },
      },
      select: { id: true },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
    });
  });

  it('should process max 10 emails per check', async () => {
    const dueEmails = Array.from({ length: 15 }, (_, i) => ({ id: `email-${i}` }));
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue(dueEmails.slice(0, 10));
    // Mock transaction to return null (already claimed) to avoid processing
    (mockPrisma.$transaction as jest.Mock).mockResolvedValue(null);

    startEmailScheduler();
    await jest.advanceTimersByTimeAsync(0);

    // take: 10 is in the query
    expect(mockPrisma.scheduledEmail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  it('should check every 60 seconds', async () => {
    (mockPrisma.scheduledEmail.findMany as jest.Mock).mockResolvedValue([]);

    startEmailScheduler();

    // Initial check
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPrisma.scheduledEmail.findMany).toHaveBeenCalledTimes(1);

    // After 60 seconds
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockPrisma.scheduledEmail.findMany).toHaveBeenCalledTimes(2);

    // After another 60 seconds
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockPrisma.scheduledEmail.findMany).toHaveBeenCalledTimes(3);
  });
});
