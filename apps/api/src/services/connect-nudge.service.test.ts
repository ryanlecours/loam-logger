// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    bike: { findFirst: jest.fn() },
    emailSend: { create: jest.fn() },
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

jest.mock('../config/env', () => ({
  FRONTEND_URL: 'https://app.test',
  API_URL: 'https://api.test',
}));

jest.mock('../lib/unsubscribe-token', () => ({
  generateUnsubscribeToken: jest.fn(() => 'unsub-token'),
}));

const mockGetConnectedRideProviders = jest.fn();
jest.mock('../lib/ride-source', () => ({
  RIDE_PROVIDERS: ['strava', 'garmin', 'whoop', 'suunto'],
  getConnectedRideProviders: (...args: unknown[]) => mockGetConnectedRideProviders(...args),
}));

const mockCaptureServerEvent = jest.fn();
jest.mock('../lib/posthog', () => ({
  captureServerEvent: (...args: unknown[]) => mockCaptureServerEvent(...args),
}));

const mockSendReactEmailWithAudit = jest.fn();
jest.mock('./email.service', () => ({
  sendReactEmailWithAudit: (...args: unknown[]) => mockSendReactEmailWithAudit(...args),
}));

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// @react-email/render's CJS build dynamic-imports react-dom/server, which
// Jest can't execute without --experimental-vm-modules. Static markup is
// equivalent for content assertions.
const render = async (element: ReactElement) => renderToStaticMarkup(element);
import { prisma } from '../lib/prisma';
import { logError } from '../lib/logger';
import {
  __resetConnectNudgeState,
  CONNECT_NUDGE_DELAY_MS,
  CONNECT_NUDGE_MAX_AGE_MS,
  connectNudgeCandidateWhere,
  maybeSendConnectNudge,
  runConnectNudgeSweep,
} from './connect-nudge.service';
import { CONNECT_NUDGE_SUBJECT, CONNECT_NUDGE_TEMPLATE_VERSION } from '../templates/emails/connect-nudge';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const NOW = new Date('2026-10-29T12:00:00Z');
const rider = { id: 'user-1', email: 'rider@example.com', name: 'Casey Rider' };

describe('connect-nudge.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetConnectNudgeState();
    (mockPrisma.emailSend.create as jest.Mock).mockResolvedValue({});
    mockGetConnectedRideProviders.mockResolvedValue([]);
    (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue({
      nickname: null,
      manufacturer: 'Transition',
      model: 'Smuggler',
    });
    mockSendReactEmailWithAudit.mockResolvedValue({ messageId: 'msg-1', status: 'sent' });
  });

  describe('connectNudgeCandidateWhere', () => {
    it('admits only onboarded, subscribed riders with a bike and no ride source', () => {
      const where = connectNudgeCandidateWhere(NOW);

      expect(where.onboardingCompleted).toBe(true);
      expect(where.emailUnsubscribed).toBe(false);
      expect(where.rides).toEqual({ none: {} });
      expect(where.integrations).toEqual({ none: { revokedAt: null } });
      expect(where.tokens).toEqual({ none: { provider: { in: ['strava', 'garmin', 'whoop', 'suunto'] } } });
    });

    it('puts the first bike between 48 hours and 14 days old', () => {
      const where = connectNudgeCandidateWhere(NOW);

      expect(where.bikes).toEqual({
        some: {
          status: 'ACTIVE',
          createdAt: { lte: new Date(NOW.getTime() - CONNECT_NUDGE_DELAY_MS) },
        },
      });
      expect(where.NOT).toEqual({
        bikes: { some: { createdAt: { lt: new Date(NOW.getTime() - CONNECT_NUDGE_MAX_AGE_MS) } } },
      });
    });

    it('excludes anyone with an audit row for this email, whatever its status', () => {
      const where = connectNudgeCandidateWhere(NOW);

      expect(where.emailSends).toEqual({
        none: { emailType: 'welcome_series', triggerSource: 'system_welcome_series' },
      });
    });
  });

  describe('maybeSendConnectNudge', () => {
    it('sends the nudge with the audit pair the sweep dedupes on and fires the event', async () => {
      const status = await maybeSendConnectNudge(rider);

      expect(status).toBe('sent');
      expect(mockSendReactEmailWithAudit).toHaveBeenCalledTimes(1);
      const params = mockSendReactEmailWithAudit.mock.calls[0][0];
      expect(params).toMatchObject({
        to: 'rider@example.com',
        subject: CONNECT_NUDGE_SUBJECT,
        userId: 'user-1',
        emailType: 'welcome_series',
        triggerSource: 'system_welcome_series',
        templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
      });
      expect(params.bypassUnsubscribe).toBeUndefined();

      const html = await render(params.reactElement);
      expect(html).toContain('Hi Casey,');
      expect(html).toContain('Transition Smuggler is set up.');
      expect(html).toContain('https://app.test/settings?section=data-sources');
      expect(html).toContain('utm_campaign=connect_nudge');
      expect(html).toContain('https://api.test/api/email/unsubscribe?token=unsub-token');

      expect(mockCaptureServerEvent).toHaveBeenCalledWith('user-1', 'connect_nudge_email_sent', {
        templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
        hasBikeName: true,
      });
    });

    it('skips a rider who connected a provider after the sweep query ran', async () => {
      mockGetConnectedRideProviders.mockResolvedValue([{ provider: 'strava', connectedAt: NOW }]);

      const status = await maybeSendConnectNudge(rider);

      expect(status).toBe('skipped');
      expect(mockSendReactEmailWithAudit).not.toHaveBeenCalled();
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('does not fire the event when the send was suppressed', async () => {
      mockSendReactEmailWithAudit.mockResolvedValue({ messageId: '', status: 'suppressed' });

      const status = await maybeSendConnectNudge(rider);

      expect(status).toBe('suppressed');
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('falls back to generic copy when the rider has no name or bike name', async () => {
      (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue(null);

      await maybeSendConnectNudge({ ...rider, name: null });

      const params = mockSendReactEmailWithAudit.mock.calls[0][0];
      const html = await render(params.reactElement);
      expect(html).toContain('Hi there,');
      expect(html).toContain('Your bike is set up.');
      expect(mockCaptureServerEvent).toHaveBeenCalledWith('user-1', 'connect_nudge_email_sent', {
        templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
        hasBikeName: false,
      });
    });
  });

  describe('runConnectNudgeSweep', () => {
    it('queries with the candidate filter for now and nudges each rider', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
        rider,
        { id: 'user-2', email: 'two@example.com', name: null },
      ]);

      await runConnectNudgeSweep(NOW);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: connectNudgeCandidateWhere(NOW),
          select: { id: true, email: true, name: true },
        })
      );
      expect(mockSendReactEmailWithAudit).toHaveBeenCalledTimes(2);
      expect(mockSendReactEmailWithAudit.mock.calls.map((c) => c[0].userId)).toEqual(['user-1', 'user-2']);
    }, 10_000);

    it('keeps going when one rider throws', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
        rider,
        { id: 'user-2', email: 'two@example.com', name: null },
      ]);
      mockSendReactEmailWithAudit
        .mockRejectedValueOnce(new Error('Resend down'))
        .mockResolvedValueOnce({ messageId: 'msg-2', status: 'sent' });

      await runConnectNudgeSweep(NOW);

      expect(logError).toHaveBeenCalledWith('connectNudge:user', expect.any(Error));
      expect(mockSendReactEmailWithAudit).toHaveBeenCalledTimes(2);
      expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith('user-2', 'connect_nudge_email_sent', expect.any(Object));
    }, 10_000);

    it('writes the failed audit row itself when the send throws before one exists', async () => {
      mockSendReactEmailWithAudit.mockRejectedValueOnce(new Error('render exploded'));

      await expect(maybeSendConnectNudge(rider)).rejects.toThrow('render exploded');

      expect(mockPrisma.emailSend.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          toEmail: 'rider@example.com',
          emailType: 'welcome_series',
          triggerSource: 'system_welcome_series',
          templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
          status: 'failed',
          failureReason: 'render exploded',
        },
      });
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it('does not retry a rider whose audit row could not be written either', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([rider]);
      mockSendReactEmailWithAudit.mockRejectedValueOnce(new Error('render exploded'));
      (mockPrisma.emailSend.create as jest.Mock).mockRejectedValueOnce(new Error('db down'));

      await runConnectNudgeSweep(NOW);
      expect(logError).toHaveBeenCalledWith('connectNudge:auditRow', expect.any(Error));
      expect(mockSendReactEmailWithAudit).toHaveBeenCalledTimes(1);

      // The candidate query still returns them next sweep; the in-memory set skips them.
      await runConnectNudgeSweep(NOW);
      expect(mockSendReactEmailWithAudit).toHaveBeenCalledTimes(1);
    });

    it('does nothing when nobody is owed the nudge', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([]);

      await runConnectNudgeSweep(NOW);

      expect(mockSendReactEmailWithAudit).not.toHaveBeenCalled();
    });
  });
});
