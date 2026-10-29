import * as React from 'react';
import type { EmailType, Prisma, TriggerSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logError, logger } from '../lib/logger';
import { getRedisConnection, isRedisReady } from '../lib/redis';
import { getConnectedRideProviders, RIDE_PROVIDERS } from '../lib/ride-source';
import { captureServerEvent } from '../lib/posthog';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';
import { FRONTEND_URL, API_URL } from '../config/env';
import { sendReactEmailWithAudit } from './email.service';
import ConnectNudgeEmail, {
  CONNECT_NUDGE_SUBJECT,
  CONNECT_NUDGE_TEMPLATE_VERSION,
} from '../templates/emails/connect-nudge';

/**
 * Connect nudge: one email, 48 hours after onboarding, to a rider who has a
 * bike but no ride source.
 *
 * The activation metric is the share of onboarding completions with a synced
 * ride within 48 hours. Phases 0 to 2 of that work made connecting import a
 * year of rides and made both dashboards say so; this is the only touch for
 * the rider who finished onboarding, skipped the connect step, and left.
 *
 * Deliberate properties:
 * - Once per account, ever. Dedupe is the EmailSend audit row this sweep
 *   writes, so a suppressed or failed attempt also counts as done: a rider
 *   who unsubscribed is never re-checked, and a provider outage never turns
 *   into a retry loop. The row's type and trigger pair is unique to this
 *   sweep, so no new EmailType value (and no migration) is needed.
 * - "No ride source" means what `User.rideSource` means: no connected
 *   provider and no ride at all, manual or recorded included.
 * - The clock starts at the first bike's creation, which onboarding writes
 *   in the same transaction as the completion flag. That gives a real
 *   completion time without adding a column. The bike must also be under
 *   14 days old: on first deploy the whole historical base of unconnected
 *   accounts would otherwise qualify at once, and a nudge about a bike
 *   added months ago reads as spam, not help.
 * - Redis-locked sweep, like the weekly digest, so two API instances never
 *   both send; skipped when Redis is down rather than risked.
 */

export const CONNECT_NUDGE_DELAY_MS = 48 * 60 * 60 * 1000;
export const CONNECT_NUDGE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The audit pair that identifies this email. It is unique by convention:
 * the admin-scheduled welcome series writes `welcome_series` with trigger
 * `scheduled`, and nothing else writes `system_welcome_series`. Anything
 * that counts `welcome_series` rows now includes nudges; filter on the
 * trigger (or the template version) to separate them. A dedicated
 * EmailType value is the right fix the next time a migration is going out
 * anyway; it is not worth a staging round trip on its own.
 */
export const CONNECT_NUDGE_EMAIL_TYPE: EmailType = 'welcome_series';
export const CONNECT_NUDGE_TRIGGER_SOURCE: TriggerSource = 'system_welcome_series';

export const CONNECT_NUDGE_EVENT = 'connect_nudge_email_sent';

/**
 * Riders per sweep. At one send per 1.1 seconds this keeps a sweep under
 * two minutes, well inside LOCK_TTL_SECONDS. Raise the two together: a
 * sweep that outlives its lock lets a second instance start sending.
 */
const SWEEP_BATCH_SIZE = 100;
/** Resend allows one send per second. */
const EMAIL_SEND_DELAY_MS = 1100;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

const LOCK_KEY = 'lock:connect-nudge:global';
/** Must stay well above SWEEP_BATCH_SIZE * EMAIL_SEND_DELAY_MS. */
const LOCK_TTL_SECONDS = 10 * 60;

/**
 * Riders whose send threw before an audit row could be written, for the
 * life of this process. The candidate query would pick them up again next
 * sweep; this keeps a render bug or a DB blip from turning into a Resend
 * call every 30 minutes until someone notices.
 */
const failedWithoutAuditRow = new Set<string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ConnectNudgeCandidate = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * The link the email's button opens: the Data Sources section of web
 * Settings, tagged so PostHog can attribute the connects it produces.
 */
export function connectNudgeUrl(): string {
  return `${FRONTEND_URL}/settings?section=data-sources&utm_source=email&utm_medium=email&utm_campaign=connect_nudge`;
}

/**
 * Everyone owed the nudge at `now`. Exported so the test can pin the shape:
 * every clause here is a reason a rider must not get this email.
 */
export function connectNudgeCandidateWhere(now: Date): Prisma.UserWhereInput {
  const dueBefore = new Date(now.getTime() - CONNECT_NUDGE_DELAY_MS);
  const notBefore = new Date(now.getTime() - CONNECT_NUDGE_MAX_AGE_MS);
  return {
    onboardingCompleted: true,
    emailUnsubscribed: false,
    // An active bike added at least 48 hours ago...
    bikes: { some: { status: 'ACTIVE', createdAt: { lte: dueBefore } } },
    // ...and no bike of any status older than 14 days, so the oldest bike,
    // which is the onboarding bike, sits inside the window.
    NOT: { bikes: { some: { createdAt: { lt: notBefore } } } },
    rides: { none: {} },
    integrations: { none: { revokedAt: null } },
    tokens: { none: { provider: { in: RIDE_PROVIDERS } } },
    emailSends: {
      none: { emailType: CONNECT_NUDGE_EMAIL_TYPE, triggerSource: CONNECT_NUDGE_TRIGGER_SOURCE },
    },
  };
}

/** The first bike, named the way the dashboard names it. */
async function firstBikeName(userId: string): Promise<string | undefined> {
  const bike = await prisma.bike.findFirst({
    where: { userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { nickname: true, manufacturer: true, model: true },
  });
  if (!bike) return undefined;
  return bike.nickname || [bike.manufacturer, bike.model].filter(Boolean).join(' ') || undefined;
}

/**
 * Send the nudge to one candidate, unless they connected since the sweep
 * query ran. Returns the audit status, or 'skipped' when nothing was sent.
 * Exported for tests.
 */
export async function maybeSendConnectNudge(
  user: ConnectNudgeCandidate
): Promise<'sent' | 'suppressed' | 'failed' | 'skipped'> {
  // The sweep query already excluded connected riders, but the one wrong
  // moment to send "connect your rides" is right after they did.
  const connected = await getConnectedRideProviders(user.id);
  if (connected.length > 0) return 'skipped';

  const bikeName = await firstBikeName(user.id);
  const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${generateUnsubscribeToken(user.id)}`;
  const recipientFirstName = user.name?.split(' ')[0] || undefined;

  let result: Awaited<ReturnType<typeof sendReactEmailWithAudit>>;
  try {
    result = await sendReactEmailWithAudit({
      to: user.email,
      subject: CONNECT_NUDGE_SUBJECT,
      reactElement: React.createElement(ConnectNudgeEmail, {
        recipientFirstName,
        bikeName,
        connectUrl: connectNudgeUrl(),
        dashboardUrl: `${FRONTEND_URL}/dashboard`,
        unsubscribeUrl,
      }),
      userId: user.id,
      emailType: CONNECT_NUDGE_EMAIL_TYPE,
      triggerSource: CONNECT_NUDGE_TRIGGER_SOURCE,
      templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
    });
  } catch (error) {
    // sendEmailWithAudit writes a failed row when the provider rejects the
    // send, but a throw from the render step, the unsubscribe lookup or the
    // audit insert itself leaves nothing behind, and the dedupe is that row.
    // Write it here so the rider is done either way, and remember them in
    // memory in case the row cannot be written either.
    failedWithoutAuditRow.add(user.id);
    try {
      await prisma.emailSend.create({
        data: {
          userId: user.id,
          toEmail: user.email,
          emailType: CONNECT_NUDGE_EMAIL_TYPE,
          triggerSource: CONNECT_NUDGE_TRIGGER_SOURCE,
          templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
          status: 'failed',
          failureReason: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    } catch (auditError) {
      logError('connectNudge:auditRow', auditError);
    }
    throw error;
  }

  if (result.status === 'sent') {
    captureServerEvent(user.id, CONNECT_NUDGE_EVENT, {
      templateVersion: CONNECT_NUDGE_TEMPLATE_VERSION,
      hasBikeName: Boolean(bikeName),
    });
  }
  logger.info({ userId: user.id, status: result.status }, '[connect-nudge] Nudge processed');
  return result.status;
}

/** One sweep over every rider owed the nudge. Exported for tests. */
export async function runConnectNudgeSweep(now: Date = new Date()): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: connectNudgeCandidateWhere(now),
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH_SIZE,
  });

  let sentAny = false;
  for (const user of candidates) {
    if (failedWithoutAuditRow.has(user.id)) continue;
    try {
      if (sentAny) await sleep(EMAIL_SEND_DELAY_MS);
      const status = await maybeSendConnectNudge(user);
      if (status !== 'skipped') sentAny = true;
    } catch (error) {
      // The failed row (or the in-memory set) marks this rider done; the
      // next one must still get theirs. A throw may have followed a real
      // provider call, so the rate-limit gap still applies before it.
      logError('connectNudge:user', error);
      sentAny = true;
    }
  }
}

/** Test hook: forget riders remembered as failed without an audit row. */
export function __resetConnectNudgeState(): void {
  failedWithoutAuditRow.clear();
}

// ---------------------------------------------------------------------------
// Scheduler plumbing, mirroring weekly-digest.service.ts.
// ---------------------------------------------------------------------------

let sweepInterval: NodeJS.Timeout | null = null;
let isSweeping = false;

async function lockedSweep(): Promise<void> {
  if (isSweeping) return;

  if (!isRedisReady()) {
    logger.warn('[connect-nudge] Redis unavailable, skipping sweep to prevent double-sends');
    return;
  }

  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const redis = getRedisConnection();
    const acquired = await redis.set(LOCK_KEY, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (acquired !== 'OK') return;
  } catch (error) {
    logError('connectNudge:lock', error);
    return;
  }

  isSweeping = true;
  try {
    await runConnectNudgeSweep();
  } catch (error) {
    logError('connectNudge:sweep', error);
  } finally {
    isSweeping = false;
    try {
      const redis = getRedisConnection();
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        LOCK_KEY,
        lockValue
      );
    } catch (error) {
      logError('connectNudge:unlock', error);
    }
  }
}

export function startConnectNudgeScheduler(): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => void lockedSweep(), SWEEP_INTERVAL_MS);
  logger.info('[connect-nudge] Scheduler started');
}

export function stopConnectNudgeScheduler(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}
