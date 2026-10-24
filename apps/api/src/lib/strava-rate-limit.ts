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
 * Two sources feed the budget check. The header snapshot sees the whole app's
 * usage, but only when Strava sends the headers and Redis takes the write. So
 * every stream fetch is also counted here, per quarter hour and per UTC day;
 * that count is always available and the check uses whichever is higher. With
 * no header snapshot the limits default to Strava's standard read limits.
 *
 * Recording never throws. Reading the count can fail (Redis down), and the
 * check then refuses: bulk work must not run blind on a shared budget.
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

let loggedMissingHeaders = false;

/** Stores the usage a Strava response reported. Never throws. */
export async function recordStravaRateLimit(
  headers: Pick<Headers, 'get'> | null | undefined
): Promise<void> {
  try {
    const snapshot = headers ? parseStravaRateLimit(headers) : null;
    if (!snapshot) {
      // Once per process: names only, so the actual header shape can be seen
      // if Strava's differs from what this parses.
      if (!loggedMissingHeaders && headers && 'keys' in headers) {
        loggedMissingHeaders = true;
        const names = [...(headers as Headers).keys()].filter((n) => /rate|limit/i.test(n));
        logger.info({ rateHeaderNames: names }, '[StravaRateLimit] No usable rate-limit headers on a Strava response');
      }
      return;
    }
    if (!isRedisReady()) return;
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
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StravaRateLimitSnapshot>;
    // A malformed value would read as "usage reset" and let batches through
    // unchecked; treat it as unknown instead.
    const valid =
      (s.kind === 'read' || s.kind === 'overall') &&
      [s.shortLimit, s.shortUsage, s.dailyLimit, s.dailyUsage].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0
      ) &&
      typeof s.recordedAt === 'string' &&
      !Number.isNaN(new Date(s.recordedAt).getTime());
    return valid ? (s as StravaRateLimitSnapshot) : null;
  } catch (err) {
    logger.warn({ err }, '[StravaRateLimit] Could not read usage');
    return null;
  }
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const readCountKeys = (now: Date) => {
  const t = now.getTime();
  return {
    short: `strava:reads:q:${Math.floor(t / QUARTER_HOUR_MS)}`,
    daily: `strava:reads:d:${Math.floor(t / DAY_MS)}`,
  };
};

/** Counts one stream fetch against this quarter hour and today. Never throws. */
export async function countStravaRead(now: Date = new Date()): Promise<void> {
  if (!isRedisReady()) return;
  try {
    const keys = readCountKeys(now);
    await getRedisConnection()
      .multi()
      .incr(keys.short)
      .expire(keys.short, 2 * 15 * 60)
      .incr(keys.daily)
      .expire(keys.daily, 2 * 24 * 60 * 60)
      .exec();
  } catch (err) {
    logger.warn({ err }, '[StravaRateLimit] Could not count a read');
  }
}

export interface OwnStravaReads {
  short: number;
  daily: number;
}

/** Stream fetches counted in the current windows; null when Redis cannot say. */
export async function getOwnStravaReads(now: Date = new Date()): Promise<OwnStravaReads | null> {
  if (!isRedisReady()) return null;
  try {
    const keys = readCountKeys(now);
    const [short, daily] = await getRedisConnection().mget(keys.short, keys.daily);
    return { short: Number(short) || 0, daily: Number(daily) || 0 };
  } catch (err) {
    logger.warn({ err }, '[StravaRateLimit] Could not read the read count');
    return null;
  }
}

/** Strava's standard read limits, used when no header snapshot says otherwise. */
export const DEFAULT_READ_LIMITS = { short: 100, daily: 1000 } as const;

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
  /** Usage in the current windows: the higher of the snapshot and our count. */
  shortUsed: number;
  dailyUsed: number;
  shortLimit: number;
  dailyLimit: number;
  /** Where the limits came from. */
  limitsFrom: 'strava-headers' | 'defaults';
}

/**
 * Whether `requests` more Strava reads fit in the bulk share of both windows.
 * Usage is the higher of what Strava last reported (counted as zero when the
 * snapshot is from an earlier window, which has since reset) and the stream
 * fetches counted here. Refuses when the count is unknown.
 */
export function checkStravaBudget(
  snapshot: StravaRateLimitSnapshot | null,
  own: OwnStravaReads | null,
  requests: number,
  now: Date = new Date()
): StravaBudgetCheck {
  const t = now.getTime();
  const shortLimit = snapshot?.shortLimit ?? DEFAULT_READ_LIMITS.short;
  const dailyLimit = snapshot?.dailyLimit ?? DEFAULT_READ_LIMITS.daily;
  const limitsFrom = snapshot ? 'strava-headers' : 'defaults';

  if (!own) {
    return {
      allowed: false,
      retryAfter: 60,
      detail: 'Strava read count unavailable (Redis); refusing rather than spending the shared budget blind',
      shortUsed: 0,
      dailyUsed: 0,
      shortLimit,
      dailyLimit,
      limitsFrom,
    };
  }

  let snapShort = 0;
  let snapDaily = 0;
  if (snapshot) {
    const at = new Date(snapshot.recordedAt).getTime();
    if (Math.floor(at / QUARTER_HOUR_MS) === Math.floor(t / QUARTER_HOUR_MS)) snapShort = snapshot.shortUsage;
    if (Math.floor(at / DAY_MS) === Math.floor(t / DAY_MS)) snapDaily = snapshot.dailyUsage;
  }
  const shortUsed = Math.max(snapShort, own.short);
  const dailyUsed = Math.max(snapDaily, own.daily);
  const base = { shortUsed, dailyUsed, shortLimit, dailyLimit, limitsFrom } as const;
  const share = Math.round(BULK_SHARE * 100);

  if (dailyUsed + requests > dailyLimit * BULK_SHARE) {
    return {
      ...base,
      allowed: false,
      retryAfter: Math.ceil((DAY_MS - (t % DAY_MS)) / 1000),
      detail: `Strava read usage today is ${dailyUsed}/${dailyLimit}; ${requests} more would pass the ${share}% bulk share`,
    };
  }
  if (shortUsed + requests > shortLimit * BULK_SHARE) {
    return {
      ...base,
      allowed: false,
      retryAfter: Math.ceil((QUARTER_HOUR_MS - (t % QUARTER_HOUR_MS)) / 1000),
      detail: `Strava read usage this 15 minutes is ${shortUsed}/${shortLimit}; ${requests} more would pass the ${share}% bulk share`,
    };
  }
  return {
    ...base,
    allowed: true,
    detail: `Strava read usage ${shortUsed}/${shortLimit} this 15 minutes, ${dailyUsed}/${dailyLimit} today (limits from ${limitsFrom})`,
  };
}
