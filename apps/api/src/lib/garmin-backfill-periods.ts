// Rolling day-window periods for Garmin imports.
//
// A Garmin import is tracked as a BackfillRequest whose `year` column holds one
// of three things: a calendar year ('2024'), 'ytd', or one of the rolling
// windows defined here ('7d'). The windows are what the clients offer. Garmin
// re-delivers whatever range we request through webhooks, so a rider who only
// wants this week's rides should not have to pull the whole season to get them.
//
// Deliberately dependency-free: the backfill route, the backfill worker and
// tier-access all need the same answer to "what does this period mean", and
// none of them should have to import the others to get it.

/** Day windows the clients offer, shortest first. */
export const GARMIN_PERIOD_DAYS = { '7d': 7, '14d': 14, '30d': 30 } as const;

export type GarminPeriod = keyof typeof GARMIN_PERIOD_DAYS;

/**
 * Days in a rolling window, or null when `period` is not one ('ytd', '2024').
 *
 * `period` arrives from a query string or a request body, so the own-property
 * check matters: a plain lookup would answer 'toString' with a function and
 * send a NaN date range to Garmin.
 */
export function parseGarminPeriodDays(period: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(GARMIN_PERIOD_DAYS, period)) return null;
  return GARMIN_PERIOD_DAYS[period as GarminPeriod];
}

/**
 * Periods that name a moving window rather than a closed span. These can be
 * re-run to pick up new rides, so only a request already in flight blocks
 * another. A calendar year, once imported, is finished for good.
 */
export function isRollingGarminPeriod(period: string): boolean {
  return period === 'ytd' || parseGarminPeriodDays(period) !== null;
}

/** `[now - N days, now]` for a rolling window, or null for any other period. */
export function resolveGarminPeriodRange(
  period: string,
  now: Date = new Date()
): { startDate: Date; endDate: Date } | null {
  const days = parseGarminPeriodDays(period);
  if (days === null) return null;

  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  return { startDate, endDate: new Date(now) };
}

/** Phrase for user-facing messages, e.g. "the last 7 days". */
export function describeGarminPeriod(period: string): string {
  const days = parseGarminPeriodDays(period);
  return days === null ? period : `the last ${days} days`;
}
