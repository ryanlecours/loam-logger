/**
 * Strava's app-wide API budget, as Strava itself last reported it.
 *
 * Every Strava response carries the app's usage against its limits in
 * headers: `X-ReadRateLimit-*` for reads (what a stream fetch is) and
 * `X-RateLimit-*` overall, each "<15-minute>,<daily>". The short window resets
 * on the quarter hour and the daily one at midnight UTC. The budget is shared
 * by every user and every path (webhook sync, backfill, lift detection), so
 * bulk admin work that spends it must leave room for the rest.
 *
 * The snapshot is best-effort: recording never throws, and a missing snapshot
 * means "unknown", not "exhausted".
 */

import { getRedisConnection, isRedisReady } from './redis';
import { logger } from './logger';

const SNAPSHOT_KEY = 'strava:ratelimit:latest';
// Long enough to carry the daily figure across the day; staleness is judged
// by recordedAt, not by expiry.
const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;

export interface StravaRateLimitSnapshot {
  /** Which header pair the figures came from. Reads are the tighter limit. */
  kind: 'read' | 'overall';
  shortLimit: number;
  shortUsage: number;
  dailyLimit: number;
  dailyUsage: number;
  recordedAt: string;
}

const parsePair = (value: string | null): [number, number] | null => {
  if (!value) return null;
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return [parts[0], parts[1]];
};

/** The read limit when Strava sends it, else the overall one. Null if neither parses. */
export function parseStravaRateLimit(
  headers: Pick<Headers, 'get'>,
  now: Date = new Date()
): StravaRateLimitSnapshot | null {
  for (const [kind, prefix] of [
    ['read', 'x-readratelimit'],
    ['overall', 'x-ratelimit'],
  ] as const) {
    const limit = parsePair(headers.get(`${prefix}-limit`));
    const usage = parsePair(headers.get(`${prefix}-usage`));
    if (limit && usage && limit[0] > 0 && limit[1] > 0) {
      return {
        kind,
        shortLimit: limit[0],
        shortUsage: usage[0],
        dailyLimit: limit[1],
        dailyUsage: usage[1],
        recordedAt: now.toISOString(),
      };
    }
  }
  return null;
}

/** Stores the usage a Strava response reported. Never throws. */
export async function recordStravaRateLimit(
  headers: Pick<Headers, 'get'> | null | undefined
): Promise<void> {
  try {
    const snapshot = headers ? parseStravaRateLimit(headers) : null;
    if (!snapshot || !isRedisReady()) return;
    await getRedisConnection().set(SNAPSHOT_KEY, JSON.stringify(snapshot), 'EX', SNAPSHOT_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, '[StravaRateLimit] Could not record usage');
  }
}

/** The last recorded snapshot, or null when none is known. Never throws. */
export async function getStravaRateLimitSnapshot(): Promise<StravaRateLimitSnapshot | null> {
  if (!isRedisReady()) return null;
  try {
    const raw = await getRedisConnection().get(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as StravaRateLimitSnapshot) : null;
  } catch (err) {
    logger.warn({ err }, '[StravaRateLimit] Could not read usage');
    return null;
  }
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bulk work may spend at most this share of either window, counting what the
 * app has already used, so live syncing always keeps the rest.
 */
export const BULK_SHARE = 0.5;

export interface StravaBudgetCheck {
  allowed: boolean;
  /** Seconds until the window that refused resets; set when not allowed. */
  retryAfter?: number;
  /** What the decision was based on, for the operator. */
  detail: string;
  /** Usage in the current windows; zero for a window the snapshot predates. */
  shortUsed: number;
  dailyUsed: number;
  shortLimit: number | null;
  dailyLimit: number | null;
}

/**
 * Whether `requests` more Strava reads fit in the bulk share of both windows.
 * Usage from a snapshot taken in an earlier window has since reset, so it
 * counts as zero. With no snapshot at all the answer is yes: the batch's own
 * responses will record one, and the next batch is checked against it.
 */
export function checkStravaBudget(
  snapshot: StravaRateLimitSnapshot | null,
  requests: number,
  now: Date = new Date()
): StravaBudgetCheck {
  if (!snapshot) {
    return {
      allowed: true,
      detail: 'no Strava usage recorded yet; allowing one batch to measure it',
      shortUsed: 0,
      dailyUsed: 0,
      shortLimit: null,
      dailyLimit: null,
    };
  }
  const at = new Date(snapshot.recordedAt).getTime();
  const t = now.getTime();
  const sameQuarter = Math.floor(at / QUARTER_HOUR_MS) === Math.floor(t / QUARTER_HOUR_MS);
  const sameDay = Math.floor(at / DAY_MS) === Math.floor(t / DAY_MS);
  const shortUsed = sameQuarter ? snapshot.shortUsage : 0;
  const dailyUsed = sameDay ? snapshot.dailyUsage : 0;
  const base = {
    shortUsed,
    dailyUsed,
    shortLimit: snapshot.shortLimit,
    dailyLimit: snapshot.dailyLimit,
  };
  const label = snapshot.kind === 'read' ? 'read' : 'overall';

  if (dailyUsed + requests > snapshot.dailyLimit * BULK_SHARE) {
    return {
      ...base,
      allowed: false,
      retryAfter: Math.ceil((DAY_MS - (t % DAY_MS)) / 1000),
      detail: `Strava ${label} usage today is ${dailyUsed}/${snapshot.dailyLimit}; ${requests} more would pass the ${BULK_SHARE * 100}% bulk share`,
    };
  }
  if (shortUsed + requests > snapshot.shortLimit * BULK_SHARE) {
    return {
      ...base,
      allowed: false,
      retryAfter: Math.ceil((QUARTER_HOUR_MS - (t % QUARTER_HOUR_MS)) / 1000),
      detail: `Strava ${label} usage this 15 minutes is ${shortUsed}/${snapshot.shortLimit}; ${requests} more would pass the ${BULK_SHARE * 100}% bulk share`,
    };
  }
  return {
    ...base,
    allowed: true,
    detail: `Strava ${label} usage ${shortUsed}/${snapshot.shortLimit} this 15 minutes, ${dailyUsed}/${snapshot.dailyLimit} today`,
  };
}
