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
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }]);
  });

  describe('notifyRideUploaded', () => {
    const baseParams = {
      userId: 'user-1',
      rideId: 'ride-1',
      durationSeconds: 3600,
      distanceMeters: 16093,
      bikeName: 'Enduro Bike',
    };

    it('should skip if user has no push token', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: null,
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });

      await notifyRideUploaded(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should skip if user has notifications disabled', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: false,
        distanceUnit: 'mi',
      });

      await notifyRideUploaded(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should send notification with miles when user prefers mi', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });

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
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'km',
      });

      await notifyRideUploaded(baseParams);

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('km'),
        }),
      ]);
    });

    it('should include bike name in body when provided', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });

      await notifyRideUploaded(baseParams);

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('on Enduro Bike'),
        }),
      ]);
    });

    it('should omit bike name from body when not provided', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });

      await notifyRideUploaded({ ...baseParams, bikeName: undefined });

      const call = mockSendPushNotificationsAsync.mock.calls[0][0][0];
      expect(call.body).not.toContain('on');
    });

    it('should log notification to database on success', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });

      await notifyRideUploaded(baseParams);

      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          notificationType: 'RIDE_UPLOADED',
        },
      });
    });

    it('should not log notification on push failure', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'error', message: 'DeviceNotRegistered' },
      ]);

      await notifyRideUploaded(baseParams);

      expect(mockPrisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('should skip if push token is invalid', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'invalid-token',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
      });

      await notifyRideUploaded(baseParams);

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
      predictions: basePredictions,
    };

    it('should skip if user has no push token', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: null,
      });

      await checkAndNotifyServiceDue(baseParams);

      expect(mockPrisma.bikeNotificationPreference.findUnique).not.toHaveBeenCalled();
    });

    it('should skip if bike notifications are disabled', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: false,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });

      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should notify when rides remaining <= threshold (RIDES_BEFORE mode)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([]);

      await checkAndNotifyServiceDue(baseParams);

      // comp-1 has 2 rides remaining (< 3 threshold), comp-2 has 10 (> 3)
      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          title: 'Enduro Bike - Service Due',
          body: expect.stringContaining('chain'),
          data: { screen: 'bike', bikeId: 'bike-1' },
        }),
      ]);
    });

    it('should notify when hours remaining <= threshold (HOURS_BEFORE mode)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'HOURS_BEFORE',
        serviceNotificationThreshold: 10,
      });
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([]);

      await checkAndNotifyServiceDue(baseParams);

      // comp-1 has 5 hours remaining (< 10), comp-2 has 30 (> 10)
      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('chain'),
        }),
      ]);
    });

    it('should only notify for DUE_NOW/OVERDUE in AT_SERVICE mode', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'AT_SERVICE',
        serviceNotificationThreshold: 3,
      });
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([]);

      // DUE_SOON should not trigger AT_SERVICE
      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should notify for OVERDUE components in AT_SERVICE mode', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'AT_SERVICE',
        serviceNotificationThreshold: 3,
      });
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([]);

      const overduePredictions = [
        { ...basePredictions[0], status: 'OVERDUE' },
      ];

      await checkAndNotifyServiceDue({ ...baseParams, predictions: overduePredictions });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalled();
    });

    it('should skip already-notified components (dedup)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });
      // comp-1 already notified
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([
        { componentId: 'comp-1' },
      ]);

      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should log notified components for dedup', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([]);

      await checkAndNotifyServiceDue(baseParams);

      expect(mockPrisma.notificationLog.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: 'user-1',
            bikeId: 'bike-1',
            componentId: 'comp-1',
            notificationType: 'SERVICE_DUE',
          }),
        ],
      });
    });

    it('should send summary notification when multiple components due', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 15,
      });
      (mockPrisma.notificationLog.findMany as jest.Mock).mockResolvedValue([]);

      // Both components under threshold
      await checkAndNotifyServiceDue(baseParams);

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: expect.stringContaining('2 components'),
        }),
      ]);
    });

    it('should not send or log if no components meet criteria', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
      });
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
