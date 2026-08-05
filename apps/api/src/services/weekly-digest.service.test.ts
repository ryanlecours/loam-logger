// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    bike: { findMany: jest.fn() },
    ride: { count: jest.fn() },
    notificationLog: { create: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../lib/redis', () => ({
  getRedisConnection: jest.fn(),
  isRedisReady: jest.fn(() => false),
}));

jest.mock('../lib/queue/notification.queue', () => ({
  enqueueReceiptCheck: jest.fn().mockResolvedValue(undefined),
}));

const mockGenerateBikePredictions = jest.fn();
jest.mock('./prediction', () => ({
  generateBikePredictions: (...args: unknown[]) => mockGenerateBikePredictions(...args),
}));

const mockSendPushNotification = jest.fn();
jest.mock('./notification.service', () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPushNotification(...args),
}));

import { prisma } from '../lib/prisma';
import { enqueueReceiptCheck } from '../lib/queue/notification.queue';
import { buildDigestBody, maybeSendDigestForUser, runWeeklyDigestSweep } from './weekly-digest.service';
import type { SubscriptionTier, UserRole } from '@prisma/client';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const proUser = {
  id: 'user-1',
  expoPushToken: 'ExponentPushToken[abc123]',
  timezone: 'UTC',
  role: 'USER' as UserRole,
  predictionMode: 'simple',
  subscriptionTier: 'PRO' as SubscriptionTier,
  isFoundingRider: false,
};

/** 2026-08-07 is a Friday; 08:30 UTC is inside the send hour for tz UTC. */
const FRIDAY_8AM_UTC = new Date('2026-08-07T08:30:00Z');
/** Same instant is 01:30 in Los Angeles — outside the send window there. */
const LA_TZ = 'America/Los_Angeles';

const bike = (id: string, nickname: string) => ({ id, nickname, manufacturer: 'M', model: 'X' });
const pred = (componentId: string, componentType: string, status: string) => ({
  componentId,
  componentType,
  brand: 'B',
  model: 'M',
  status,
  hoursRemaining: 1,
  ridesRemainingEstimate: 1,
});

describe('weekly-digest.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendPushNotification.mockResolvedValue('ticket-1');
    (mockPrisma.notificationLog.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.notificationLog.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.ride.count as jest.Mock).mockResolvedValue(0);
  });

  describe('buildDigestBody', () => {
    it('returns null with no active bikes — nothing worth waking a phone for', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([]);

      expect(await buildDigestBody(proUser)).toBeNull();
    });

    it('answers the core question directly when everything is healthy', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([
        bike('b1', 'Smuggler'),
        bike('b2', 'TYEE'),
        bike('b3', 'JACKAL'),
      ]);
      mockGenerateBikePredictions.mockResolvedValue({ components: [pred('c1', 'FORK', 'ALL_GOOD')] });

      expect(await buildDigestBody(proUser)).toBe('All 3 bikes good to go');
    });

    it('names the single bike in the all-good case', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([bike('b1', 'Smuggler')]);
      mockGenerateBikePredictions.mockResolvedValue({ components: [] });

      expect(await buildDigestBody(proUser)).toBe('Smuggler good to go');
    });

    it('leads with the worst bike and truncates to two bikes and two components', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([
        bike('b1', 'Mild'),
        bike('b2', 'Bad'),
        bike('b3', 'AlsoDue'),
      ]);
      mockGenerateBikePredictions
        // b1: one due-soon issue
        .mockResolvedValueOnce({ components: [pred('c1', 'CHAIN', 'DUE_SOON')] })
        // b2: overdue + due now + due soon — worst bike, 3 issues
        .mockResolvedValueOnce({
          components: [
            pred('c2', 'FORK', 'OVERDUE'),
            pred('c3', 'BRAKE_PAD', 'DUE_NOW'),
            pred('c4', 'SHOCK', 'DUE_SOON'),
          ],
        })
        // b3: due now
        .mockResolvedValueOnce({ components: [pred('c5', 'CASSETTE', 'DUE_NOW')] });

      const body = await buildDigestBody(proUser);

      // Worst bike leads, its list truncates at two, third bike collapses
      // into the counter.
      expect(body).toContain('Bad: fork overdue, brake pad due now, +1 more');
      expect(body?.indexOf('Bad')).toBeLessThan(body!.indexOf('AlsoDue'));
      expect(body).toContain('1 more bike needs work');
      expect(body).not.toContain('Mild:');
    });

    it('appends the unassigned-rides fragment when rides are waiting on a bike', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([bike('b1', 'Smuggler')]);
      mockGenerateBikePredictions.mockResolvedValue({ components: [] });
      (mockPrisma.ride.count as jest.Mock).mockResolvedValue(3);

      expect(await buildDigestBody(proUser)).toBe('Smuggler good to go · 3 rides need a bike');
    });

    it('counts unassigned rides with the canonical predicate (unowned excluded)', async () => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([bike('b1', 'Smuggler')]);
      mockGenerateBikePredictions.mockResolvedValue({ components: [] });

      await buildDigestBody(proUser);

      expect(mockPrisma.ride.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', bikeId: null, unownedBike: false },
      });
    });
  });

  describe('maybeSendDigestForUser', () => {
    beforeEach(() => {
      (mockPrisma.bike.findMany as jest.Mock).mockResolvedValue([bike('b1', 'Smuggler')]);
      mockGenerateBikePredictions.mockResolvedValue({ components: [] });
    });

    it('sends inside the local Friday-8am window and records the log', async () => {
      await maybeSendDigestForUser(proUser, FRIDAY_8AM_UTC);

      expect(mockSendPushNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Weekend bike check',
          body: 'Smuggler good to go',
          data: { screen: 'dashboard' },
        })
      );
      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', notificationType: 'WEEKLY_DIGEST' },
      });
      expect(enqueueReceiptCheck).toHaveBeenCalledWith('user-1', ['ticket-1'], 'ExponentPushToken[abc123]');
    });

    it('does not send outside the window — 8:30 UTC is 1:30am in Los Angeles', async () => {
      await maybeSendDigestForUser({ ...proUser, timezone: LA_TZ }, FRIDAY_8AM_UTC);

      expect(mockSendPushNotification).not.toHaveBeenCalled();
    });

    it('does not send twice in one week', async () => {
      (mockPrisma.notificationLog.findFirst as jest.Mock).mockResolvedValue({ id: 'sent' });

      await maybeSendDigestForUser(proUser, FRIDAY_8AM_UTC);

      expect(mockSendPushNotification).not.toHaveBeenCalled();
    });

    it('skips free users — the digest is a prediction surface', async () => {
      await maybeSendDigestForUser(
        { ...proUser, subscriptionTier: 'FREE' as SubscriptionTier },
        FRIDAY_8AM_UTC
      );

      expect(mockSendPushNotification).not.toHaveBeenCalled();
    });

    it('skips users with an invalid stored timezone instead of throwing', async () => {
      await maybeSendDigestForUser({ ...proUser, timezone: 'Not/AZone' }, FRIDAY_8AM_UTC);

      expect(mockSendPushNotification).not.toHaveBeenCalled();
    });

    it('does not record a log when the send fails, so the next sweep retries', async () => {
      mockSendPushNotification.mockResolvedValue(null);

      await maybeSendDigestForUser(proUser, FRIDAY_8AM_UTC);

      expect(mockPrisma.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('runWeeklyDigestSweep', () => {
    it('one failing user does not cost the users after them their digest', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
        { ...proUser, id: 'user-bad' },
        { ...proUser, id: 'user-good' },
      ]);
      (mockPrisma.bike.findMany as jest.Mock)
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValue([bike('b1', 'Smuggler')]);
      mockGenerateBikePredictions.mockResolvedValue({ components: [] });

      await runWeeklyDigestSweep(FRIDAY_8AM_UTC);

      expect(mockSendPushNotification).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notificationLog.create).toHaveBeenCalledWith({
        data: { userId: 'user-good', notificationType: 'WEEKLY_DIGEST' },
      });
    });

    it('only queries opted-in users with a token and a timezone', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([]);

      await runWeeklyDigestSweep(FRIDAY_8AM_UTC);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            weeklyDigestEnabled: true,
            expoPushToken: { not: null },
            timezone: { not: null },
          },
        })
      );
    });
  });
});
