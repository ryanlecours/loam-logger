jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      update: jest.fn(),
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

  it('should clear push token on DeviceNotRegistered', async () => {
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

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { expoPushToken: null },
    });
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
    }));

    // Token should only be cleared once despite multiple DeviceNotRegistered receipts
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
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
