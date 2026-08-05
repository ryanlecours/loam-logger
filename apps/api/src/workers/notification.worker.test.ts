jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockGetPushNotificationReceiptsAsync = jest.fn();
const mockChunkPushNotificationReceiptIds = jest.fn((ids: string[]) => [ids]);
jest.mock('expo-server-sdk', () => ({
  Expo: jest.fn(() => ({
    getPushNotificationReceiptsAsync: mockGetPushNotificationReceiptsAsync,
    chunkPushNotificationReceiptIds: mockChunkPushNotificationReceiptIds,
  })),
}));

jest.mock('../lib/queue/connection', () => ({
  getQueueConnection: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { processReceiptCheck } from './notification.worker';
import type { Job } from 'bullmq';
import type { NotificationJobData, NotificationJobName } from '../lib/queue/notification.queue';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function createMockJob(data: NotificationJobData): Job<NotificationJobData, void, NotificationJobName> {
  return { data } as Job<NotificationJobData, void, NotificationJobName>;
}

describe('notification.worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it('should not write to DB when all receipts are ok', async () => {
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'ticket-1': { status: 'ok' },
      'ticket-2': { status: 'ok' },
    });

    await processReceiptCheck(createMockJob({
      userId: 'user-1',
      ticketIds: ['ticket-1', 'ticket-2'],
    }));

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should clear push token on DeviceNotRegistered, matching on the token sent', async () => {
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'ticket-1': {
        status: 'error',
        message: 'The device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    });

    await processReceiptCheck(createMockJob({
      userId: 'user-1',
      ticketIds: ['ticket-1'],
      pushToken: 'ExponentPushToken[dead]',
    }));

    // Compare-and-clear, not a blind null: the where clause pins the clear
    // to the token these tickets were actually sent to.
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', expoPushToken: 'ExponentPushToken[dead]' },
      data: { expoPushToken: null },
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  /**
   * The race this guards. Receipts are polled ~15 minutes after the send, so
   * another device on the same account can easily have registered in the
   * meantime and claimed the single expoPushToken slot. Blindly nulling on
   * a dead device's DeviceNotRegistered would kill push on that live device.
   * The where-clause match makes it a no-op instead.
   */
  it('leaves a newer device token intact when the dead token no longer matches', async () => {
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'ticket-1': {
        status: 'error',
        message: 'The device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    });
    // Another device already claimed the slot, so zero rows match.
    (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await processReceiptCheck(createMockJob({
      userId: 'user-1',
      ticketIds: ['ticket-1'],
      pushToken: 'ExponentPushToken[dead]',
    }));

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', expoPushToken: 'ExponentPushToken[dead]' },
      data: { expoPushToken: null },
    });
  });

  it('skips the clear entirely for a legacy job carrying no pushToken', async () => {
    // Jobs enqueued before pushToken existed on the payload drain within one
    // receipt delay of a deploy. Skipping is deliberate: falling back to the
    // blind write would reintroduce exactly the bug this guards against. The
    // dead token survives until the next send fails with the token attached.
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'ticket-1': {
        status: 'error',
        message: 'The device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    });

    await processReceiptCheck(createMockJob({
      userId: 'user-1',
      ticketIds: ['ticket-1'],
    }));

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should not clear push token on non-DeviceNotRegistered errors', async () => {
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'ticket-1': {
        status: 'error',
        message: 'Rate limit exceeded',
        details: { error: 'MessageRateExceeded' },
      },
    });

    await processReceiptCheck(createMockJob({
      userId: 'user-1',
      ticketIds: ['ticket-1'],
    }));

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('should process all receipts in a chunk even after DeviceNotRegistered', async () => {
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'ticket-1': {
        status: 'error',
        message: 'The device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
      'ticket-2': {
        status: 'error',
        message: 'The device is not registered',
        details: { error: 'DeviceNotRegistered' },
      },
    });

    await processReceiptCheck(createMockJob({
      userId: 'user-1',
      ticketIds: ['ticket-1', 'ticket-2'],
      pushToken: 'ExponentPushToken[dead]',
    }));

    // Token should only be cleared once despite multiple DeviceNotRegistered receipts
    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('should rethrow when Expo receipt fetch fails (for BullMQ retry)', async () => {
    const expoError = new Error('Expo API unavailable');
    mockGetPushNotificationReceiptsAsync.mockRejectedValue(expoError);

    await expect(
      processReceiptCheck(createMockJob({
        userId: 'user-1',
        ticketIds: ['ticket-1'],
      }))
    ).rejects.toThrow('Expo API unavailable');

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
