// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    bikeNotificationPreference: {
      findUnique: jest.fn(),
    },
    notificationLog: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../lib/queue/notification.queue', () => ({
  enqueueReceiptCheck: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-server-sdk
const mockSendPushNotificationsAsync = jest.fn();
jest.mock('expo-server-sdk', () => {
  return {
    Expo: Object.assign(
      jest.fn(() => ({
        sendPushNotificationsAsync: mockSendPushNotificationsAsync,
      })),
      {
        isExpoPushToken: jest.fn((token: string) => token.startsWith('ExponentPushToken[')),
      }
    ),
  };
});

import { prisma } from '../lib/prisma';
import {
  notifyRideUploaded,
  checkAndNotifyServiceDue,
  clearServiceNotificationLogs,
} from './notification.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('notification.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-123' }]);
    (mockPrisma.notificationLog.create as jest.Mock).mockResolvedValue({});
  });

  describe('notifyRideUploaded', () => {
    const baseUser = {
      expoPushToken: 'ExponentPushToken[abc123]',
      notifyOnRideUpload: true,
      distanceUnit: 'mi' as string | null,
    };

    const baseParams = {
      userId: 'user-1',
      rideId: 'ride-1',
      durationSeconds: 3600,
      distanceMeters: 16093,
      bikeName: 'Enduro Bike',
      user: baseUser,
    };

    it('should skip if user has notifications disabled', async () => {
      await notifyRideUploaded({ ...baseParams, user: { ...baseUser, notifyOnRideUpload: false } });

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should send notification with miles when user prefers mi', async () => {
      await notifyRideUploaded(baseParams);

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          to: 'ExponentPushToken[abc123]',
          title: 'Ride Synced',
          body: expect.stringContaining('mi'),
          data: { screen: 'ride', rideId: 'ride-1' },
        }),
      ]);
    });

    it('should send notification with km when user prefers km', async () => {
      await notifyRideUploaded({ ...baseParams, user: { ...baseUser, distanceUnit: 'km' } });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('km'),
        }),
      ]);
    });

    it('should include bike name in body when provided', async () => {
      await notifyRideUploaded(baseParams);

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('on Enduro Bike'),
        }),
      ]);
    });

    it('should omit bike name from body when not provided', async () => {
      await notifyRideUploaded({ ...baseParams, bikeName: undefined });

      const call = mockSendPushNotificationsAsync.mock.calls[0][0][0];
      expect(call.body).not.toContain('on');
    });

    it('should log notification to database on success', async () => {
      await notifyRideUploaded(baseParams);

      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          notificationType: 'RIDE_UPLOADED',
        },
      });
    });

    it('should not log notification on push failure', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'error', message: 'DeviceNotRegistered' },
      ]);

      await notifyRideUploaded(baseParams);

      expect(mockPrisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('should skip if push token is invalid', async () => {
      await notifyRideUploaded({ ...baseParams, user: { ...baseUser, expoPushToken: 'invalid-token' } });

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });
  });

  describe('checkAndNotifyServiceDue', () => {
    const basePredictions = [
      {
        componentId: 'comp-1',
        componentType: 'CHAIN',
        brand: 'SRAM',
        model: 'GX',
        status: 'DUE_SOON',
        hoursRemaining: 5,
        ridesRemainingEstimate: 2,
      },
      {
        componentId: 'comp-2',
        componentType: 'BRAKE_PAD',
        brand: 'Shimano',
        model: 'XT',
        status: 'ALL_GOOD',
        hoursRemaining: 30,
        ridesRemainingEstimate: 10,
      },
    ];

    const baseParams = {
      userId: 'user-1',
      bikeId: 'bike-1',
      bikeName: 'Enduro Bike',
      pushToken: 'ExponentPushToken[abc123]',
      predictions: basePredictions,
    };

    it('should skip if bike notifications are disabled', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: false,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });

      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should notify when rides remaining <= threshold (RIDES_BEFORE mode)', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });

      await checkAndNotifyServiceDue(baseParams);

      // comp-1 has 2 rides remaining (< 3 threshold), comp-2 has 10 (> 3)
      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          title: 'Enduro Bike - Service Due',
          body: expect.stringContaining('2 rides left'),
          data: { screen: 'bike', bikeId: 'bike-1' },
        }),
      ]);
    });

    it('should notify when hours remaining <= threshold (HOURS_BEFORE mode)', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'HOURS_BEFORE',
        serviceNotificationThreshold: 10,
      });

      await checkAndNotifyServiceDue(baseParams);

      // comp-1 has 5 hours remaining (< 10), comp-2 has 30 (> 10)
      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('5h left'),
        }),
      ]);
    });

    it('should only notify for DUE_NOW/OVERDUE in AT_SERVICE mode', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'AT_SERVICE',
        serviceNotificationThreshold: 3,
      });

      // DUE_SOON should not trigger AT_SERVICE
      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should notify for OVERDUE components in AT_SERVICE mode', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'AT_SERVICE',
        serviceNotificationThreshold: 3,
      });

      const overduePredictions = [
        { ...basePredictions[0], status: 'OVERDUE' },
      ];

      await checkAndNotifyServiceDue({ ...baseParams, predictions: overduePredictions });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('overdue'),
        }),
      ]);
    });

    it('should skip already-notified components (dedup via unique constraint)', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });
      // comp-1 create fails with unique constraint violation (already notified)
      (mockPrisma.notificationLog.create as jest.Mock).mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`userId`,`componentId`,`notificationType`)')
      );

      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should claim dedup slots via individual creates before sending', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });

      await checkAndNotifyServiceDue(baseParams);

      // comp-1 meets threshold (2 < 3), so a dedup log should be created
      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          bikeId: 'bike-1',
          componentId: 'comp-1',
          notificationType: 'SERVICE_DUE',
        }),
      });
    });

    it('should skip ALL_GOOD components even when estimate is below threshold', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 15,
      });

      const predictions = [
        { ...basePredictions[1], ridesRemainingEstimate: 1 }, // ALL_GOOD with low estimate
      ];

      await checkAndNotifyServiceDue({ ...baseParams, predictions });

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should send summary notification when multiple components due', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 15,
      });

      // Both components non-ALL_GOOD and under threshold
      const predictions = [
        basePredictions[0], // DUE_SOON, 2 rides remaining
        { ...basePredictions[1], status: 'DUE_SOON' }, // override ALL_GOOD → DUE_SOON
      ];
      await checkAndNotifyServiceDue({ ...baseParams, predictions });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('2 components'),
        }),
      ]);
    });

    it('should not send or log if no components meet criteria', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 1, // Both components above this
      });

      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });
  });

  describe('clearServiceNotificationLogs', () => {
    it('should delete notification logs for the given component', async () => {
      await clearServiceNotificationLogs('comp-1');

      expect(mockPrisma.notificationLog.deleteMany).toHaveBeenCalledWith({
        where: {
          componentId: 'comp-1',
          notificationType: 'SERVICE_DUE',
        },
      });
    });
  });
});
