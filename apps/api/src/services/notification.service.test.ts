// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    bike: {
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

const mockGenerateBikePredictions = jest.fn();
jest.mock('./prediction', () => ({
  generateBikePredictions: (...args: unknown[]) => mockGenerateBikePredictions(...args),
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
import { enqueueReceiptCheck } from '../lib/queue/notification.queue';
import {
  fireRideNotifications,
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

    it('should send a combined upload + pick-bike notification when needsBikeAssignment is true', async () => {
      await notifyRideUploaded({ ...baseParams, bikeName: undefined, needsBikeAssignment: true });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          title: 'Ride Synced',
          body: expect.stringContaining('Tap to choose which bike'),
          data: { screen: 'ride', rideId: 'ride-1', action: 'pickBike' },
        }),
      ]);
    });

    it('should send the pick-bike prompt even when notifyOnRideUpload is false', async () => {
      await notifyRideUploaded({
        ...baseParams,
        bikeName: undefined,
        needsBikeAssignment: true,
        user: { ...baseUser, notifyOnRideUpload: false },
      });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
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

    it('should return ticket id on success', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-123' }]);

      const result = await notifyRideUploaded(baseParams);

      expect(result).toBe('ticket-123');
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
      const prismaError = Object.assign(
        new Error('Unique constraint failed on the fields: (`userId`,`componentId`,`notificationType`)'),
        { code: 'P2002' }
      );
      (mockPrisma.notificationLog.create as jest.Mock).mockRejectedValue(prismaError);

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

    it('should roll back dedup entries when push send fails', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'error', message: 'DeviceNotRegistered' },
      ]);

      await checkAndNotifyServiceDue(baseParams);

      expect(mockPrisma.notificationLog.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          componentId: { in: ['comp-1'] },
          notificationType: 'SERVICE_DUE',
        },
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
          body: expect.stringMatching(/2 components need service: chain \(2 rides left\), brake pad \(\d+ rides left\)/),
        }),
      ]);
    });

    it('should truncate component list when more than 2 are due', async () => {
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue({
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 15,
      });

      const predictions = [
        { ...basePredictions[0], componentType: 'CHAIN', status: 'DUE_SOON', ridesRemainingEstimate: 2 },
        { ...basePredictions[0], componentId: 'comp-2', componentType: 'FORK', status: 'DUE_SOON', ridesRemainingEstimate: 3 },
        { ...basePredictions[0], componentId: 'comp-3', componentType: 'BRAKE_PAD', status: 'DUE_SOON', ridesRemainingEstimate: 4 },
      ];
      await checkAndNotifyServiceDue({ ...baseParams, predictions });

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledWith([
        expect.objectContaining({
          body: '3 components need service: chain (2 rides left), fork (3 rides left), and 1 more',
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

  describe('fireRideNotifications', () => {
    const baseParams = {
      userId: 'user-1',
      rideId: 'ride-1',
      bikeId: 'bike-1',
      durationSeconds: 3600,
      distanceMeters: 16093,
      isNewRide: true,
    };

    beforeEach(() => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
        role: 'USER',
        predictionMode: 'simple',
      });
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({
        nickname: 'Trail Bike',
        manufacturer: 'Santa Cruz',
        model: 'Hightower',
      });
      mockGenerateBikePredictions.mockResolvedValue(null);
    });

    it('should return early when isNewRide is false', async () => {
      await fireRideNotifications({ ...baseParams, isNewRide: false });

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return early when user has no push token', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: null,
        notifyOnRideUpload: true,
        distanceUnit: 'mi',
        role: 'USER',
        predictionMode: 'simple',
      });

      await fireRideNotifications(baseParams);

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('should skip service check when generateBikePredictions returns null', async () => {
      mockGenerateBikePredictions.mockResolvedValue(null);

      await fireRideNotifications(baseParams);

      expect(mockPrisma.bikeNotificationPreference.findUnique).not.toHaveBeenCalled();
    });

    it('should enqueue receipt check when notifications are sent', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-abc' }]);

      await fireRideNotifications(baseParams);

      expect(enqueueReceiptCheck).toHaveBeenCalledWith('user-1', expect.arrayContaining([expect.any(String)]));
    });

    it('should not enqueue receipt check when no tickets are produced', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        expoPushToken: 'ExponentPushToken[abc123]',
        notifyOnRideUpload: false,
        distanceUnit: 'mi',
        role: 'USER',
        predictionMode: 'simple',
      });
      mockGenerateBikePredictions.mockResolvedValue(null);

      await fireRideNotifications(baseParams);

      expect(enqueueReceiptCheck).not.toHaveBeenCalled();
    });

    it('should fold the pick-bike prompt into the upload notification when bike is unassigned and user has 2+ bikes', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-pick' }]);

      await fireRideNotifications({
        ...baseParams,
        bikeId: null,
        activeBikeCount: 3,
      });

      const bikePickCalls = mockSendPushNotificationsAsync.mock.calls.filter(
        (call) => call[0]?.[0]?.data?.action === 'pickBike'
      );
      // Exactly one push carries the pickBike hint — no separate "Assign a
      // Bike" notification.
      expect(bikePickCalls).toHaveLength(1);
      expect(bikePickCalls[0][0][0]).toMatchObject({
        title: 'Ride Synced',
        body: expect.stringContaining('Tap to choose which bike'),
        data: { screen: 'ride', rideId: 'ride-1', action: 'pickBike' },
      });
    });

    it('should not fold in the pick-bike prompt when user has only one bike', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-x' }]);

      await fireRideNotifications({
        ...baseParams,
        bikeId: null,
        activeBikeCount: 1,
      });

      const bikePickCall = mockSendPushNotificationsAsync.mock.calls.find(
        (call) => call[0]?.[0]?.data?.action === 'pickBike'
      );
      expect(bikePickCall).toBeUndefined();
    });

    it('should not fold in the pick-bike prompt when bike is already assigned', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'ticket-y' }]);

      await fireRideNotifications({
        ...baseParams,
        bikeId: 'bike-1',
        activeBikeCount: 5,
      });

      const bikePickCall = mockSendPushNotificationsAsync.mock.calls.find(
        (call) => call[0]?.[0]?.data?.action === 'pickBike'
      );
      expect(bikePickCall).toBeUndefined();
    });
  });

  describe('clearServiceNotificationLogs', () => {
    it('should delete notification logs scoped to the user and component', async () => {
      await clearServiceNotificationLogs('comp-1', 'user-1');

      expect(mockPrisma.notificationLog.deleteMany).toHaveBeenCalledWith({
        where: {
          componentId: 'comp-1',
          userId: 'user-1',
          notificationType: 'SERVICE_DUE',
        },
      });
    });
  });
});
