import { prisma } from '../lib/prisma';
import { logError, logger } from '../lib/logger';
import { getRedisConnection, isRedisReady } from '../lib/redis';
import { enqueueReceiptCheck } from '../lib/queue/notification.queue';
import { UNASSIGNED_RIDE_WHERE } from '../lib/ride-predicates';
import { sendPushNotification } from './notification.service';
import { generateBikePredictions } from './prediction';
import { canSeePredictions } from '../auth/tier-access';
import { formatComponentType } from '@loam/shared';
import type { SubscriptionTier, UserRole } from '@prisma/client';

/**
 * Weekly gear-health digest.
 *
 * One push, Friday 8am in the rider's local time, answering the product's
 * core question before the weekend: "Is the bike I want to ride good to go,
 * or what needs to be done to get it good to go?"
 *
 * Deliberate properties, all load-bearing:
 * - Opt-in and off by default. This is the only push in the system that is
 *   not a direct consequence of something the rider did, so it must be asked
 *   for, never assumed.
 * - Pro-gated at send time (`canSeePredictions`), like every other surface
 *   that shows predictions.
 * - Skips riders with no stored timezone rather than guessing. A digest at
 *   3am teaches a rider to disable notifications; no digest teaches nothing.
 * - The all-good week still sends ("All 3 bikes good to go"). Unlike the
 *   event-driven pushes, where silence means nothing is wrong, a rider who
 *   opted into a weekly check is owed the answer either way — an opt-in
 *   digest that only ever brings bad news reads as nagging, not as a check.
 * - Statuses come straight from predictions, independent of each bike's
 *   BikeNotificationPreference. Those thresholds tune the event-driven
 *   service-due push; the digest is a summary of state, not an alert.
 */

const DIGEST_TITLE = 'Weekend bike check';
/** Friday, matching Intl's en-US short weekday form. */
const DIGEST_LOCAL_WEEKDAY = 'Fri';
/** Send during the 08:00–08:59 local hour. */
const DIGEST_LOCAL_HOUR = 8;
/**
 * Sweep every 15 minutes: several chances to catch each user's local 8am
 * hour, close enough to 8:00 to still read as "morning".
 */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
/**
 * "Already sent this week" window. Six days rather than seven so DST shifts
 * and sweep-timing drift can never skip a week outright.
 */
const SENT_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

const LOCK_KEY = 'lock:weekly-digest:global';
const LOCK_TTL_SECONDS = 10 * 60;

/** Severity order for picking what leads the body. */
const STATUS_RANK: Record<string, number> = { OVERDUE: 0, DUE_NOW: 1, DUE_SOON: 2 };
const STATUS_WORD: Record<string, string> = {
  OVERDUE: 'overdue',
  DUE_NOW: 'due now',
  DUE_SOON: 'due soon',
};

type DigestUser = {
  id: string;
  expoPushToken: string | null;
  timezone: string | null;
  role: UserRole;
  predictionMode: string | null;
  subscriptionTier: SubscriptionTier;
  isFoundingRider: boolean;
};

/**
 * The rider's local weekday and hour, or null when the stored timezone is
 * invalid (the resolver validates writes, but a bad value must degrade to
 * "skip", never to a throw that kills the sweep for everyone after them).
 */
function localParts(timezone: string, now: Date): { weekday: string; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hourRaw = parts.find((p) => p.type === 'hour')?.value;
    if (!weekday || hourRaw === undefined) return null;
    // Intl renders midnight as "24" in some hour12:false locales; normalize.
    const hour = Number(hourRaw) % 24;
    return Number.isNaN(hour) ? null : { weekday, hour };
  } catch {
    return null;
  }
}

/**
 * Compose the digest body for one user, or null when there is nothing worth
 * sending (no active bikes).
 *
 * Shape: at most two bikes named with at most two components each, then
 * counts. "Smuggler: fork overdue, chain due soon · TYEE: brake pads due
 * now · 2 more bikes need work · 3 rides need a bike". Copy reuses the
 * dashboard's own vocabulary ("need work", "need a bike", "good to go") so
 * the push and the screen it opens describe the world identically.
 */
export async function buildDigestBody(user: DigestUser): Promise<string | null> {
  const bikes = await prisma.bike.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    select: { id: true, nickname: true, manufacturer: true, model: true },
  });
  if (bikes.length === 0) return null;

  const predictionMode = (user.predictionMode === 'predictive' ? 'predictive' : 'simple') as 'simple' | 'predictive';

  type BikeIssues = {
    name: string;
    /** Sorted worst-first. */
    issues: { componentType: string; status: string }[];
  };
  const bikesWithIssues: BikeIssues[] = [];

  for (const bike of bikes) {
    const name = bike.nickname || [bike.manufacturer, bike.model].filter(Boolean).join(' ') || 'Bike';
    const summary = await generateBikePredictions({
      userId: user.id,
      bikeId: bike.id,
      userRole: user.role,
      predictionMode,
      subscriptionTier: user.subscriptionTier,
      isFoundingRider: user.isFoundingRider,
    });
    const issues = (summary?.components ?? [])
      .filter((c) => c.status !== 'ALL_GOOD' && c.status in STATUS_RANK)
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
      .map((c) => ({ componentType: c.componentType, status: c.status }));
    if (issues.length > 0) {
      bikesWithIssues.push({ name, issues });
    }
  }

  const unassignedCount = await prisma.ride.count({
    where: { userId: user.id, ...UNASSIGNED_RIDE_WHERE },
  });

  const fragments: string[] = [];

  if (bikesWithIssues.length === 0) {
    if (bikes.length === 1) {
      const only = bikes[0];
      const name = only.nickname || [only.manufacturer, only.model].filter(Boolean).join(' ') || 'Your bike';
      fragments.push(`${name} good to go`);
    } else {
      fragments.push(`All ${bikes.length} bikes good to go`);
    }
  } else {
    // Worst bike first: lead with the strongest reason the push exists.
    bikesWithIssues.sort(
      (a, b) => STATUS_RANK[a.issues[0].status] - STATUS_RANK[b.issues[0].status]
    );
    const MAX_BIKES = 2;
    const MAX_COMPONENTS = 2;
    for (const bike of bikesWithIssues.slice(0, MAX_BIKES)) {
      const listed = bike.issues
        .slice(0, MAX_COMPONENTS)
        .map((i) => `${formatComponentType(i.componentType, null, { case: 'lower' })} ${STATUS_WORD[i.status]}`)
        .join(', ');
      const extra = bike.issues.length - MAX_COMPONENTS;
      fragments.push(extra > 0 ? `${bike.name}: ${listed}, +${extra} more` : `${bike.name}: ${listed}`);
    }
    const moreBikes = bikesWithIssues.length - MAX_BIKES;
    if (moreBikes > 0) {
      fragments.push(`${moreBikes} more ${moreBikes === 1 ? 'bike needs' : 'bikes need'} work`);
    }
  }

  if (unassignedCount > 0) {
    fragments.push(`${unassignedCount} ${unassignedCount === 1 ? 'ride needs' : 'rides need'} a bike`);
  }

  return fragments.join(' · ');
}

/** Decide-and-send for one candidate. Exported for tests. */
export async function maybeSendDigestForUser(user: DigestUser, now: Date): Promise<void> {
  if (!user.expoPushToken || !user.timezone) return;
  if (!canSeePredictions(user)) return;

  const local = localParts(user.timezone, now);
  if (!local || local.weekday !== DIGEST_LOCAL_WEEKDAY || local.hour !== DIGEST_LOCAL_HOUR) return;

  const alreadySent = await prisma.notificationLog.findFirst({
    where: {
      userId: user.id,
      notificationType: 'WEEKLY_DIGEST',
      sentAt: { gte: new Date(now.getTime() - SENT_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (alreadySent) return;

  const body = await buildDigestBody(user);
  if (!body) return;

  const ticketId = await sendPushNotification({
    pushToken: user.expoPushToken,
    title: DIGEST_TITLE,
    body,
    data: { screen: 'dashboard' },
  });
  if (!ticketId) return;

  await prisma.notificationLog.create({
    data: { userId: user.id, notificationType: 'WEEKLY_DIGEST' },
  });
  enqueueReceiptCheck(user.id, [ticketId], user.expoPushToken).catch((err) =>
    logError('enqueueReceiptCheck', err)
  );

  logger.info({ userId: user.id }, '[weekly-digest] Digest sent');
}

/** One sweep over every opted-in user. Exported for tests. */
export async function runWeeklyDigestSweep(now: Date = new Date()): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: {
      weeklyDigestEnabled: true,
      expoPushToken: { not: null },
      timezone: { not: null },
    },
    select: {
      id: true,
      expoPushToken: true,
      timezone: true,
      role: true,
      predictionMode: true,
      subscriptionTier: true,
      isFoundingRider: true,
    },
  });

  for (const user of candidates) {
    try {
      await maybeSendDigestForUser(user, now);
    } catch (error) {
      // One rider's bad data must not cost everyone after them their digest.
      logError('weeklyDigest:user', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler plumbing — mirrors import-session-checker.service.ts: a plain
// interval whose body takes a Redis lock so multiple API instances don't
// double-send, and skips (rather than risks it) when Redis is down.
// ---------------------------------------------------------------------------

let sweepInterval: NodeJS.Timeout | null = null;
let isSweeping = false;

async function lockedSweep(): Promise<void> {
  if (isSweeping) return;

  if (!isRedisReady()) {
    logger.warn('[weekly-digest] Redis unavailable, skipping sweep to prevent double-sends');
    return;
  }

  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const redis = getRedisConnection();
    const acquired = await redis.set(LOCK_KEY, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (acquired !== 'OK') return;
  } catch (error) {
    logError('weeklyDigest:lock', error);
    return;
  }

  isSweeping = true;
  try {
    await runWeeklyDigestSweep();
  } catch (error) {
    logError('weeklyDigest:sweep', error);
  } finally {
    isSweeping = false;
    // Atomic check-and-delete so an expired-and-reacquired lock is never
    // released out from under another instance.
    try {
      const redis = getRedisConnection();
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        LOCK_KEY,
        lockValue
      );
    } catch (error) {
      logError('weeklyDigest:unlock', error);
    }
  }
}

export function startWeeklyDigestScheduler(): void {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => void lockedSweep(), SWEEP_INTERVAL_MS);
  logger.info('[weekly-digest] Scheduler started');
}

export function stopWeeklyDigestScheduler(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}
