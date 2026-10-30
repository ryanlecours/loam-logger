/**
 * What a component or a bike has cost, in one currency, and what that comes to
 * per ride hour.
 *
 * Money here is the rider's own record: Component.purchasePriceMinor,
 * Bike.purchasePriceMinor and ServiceLog.costMinor, all integer minor units
 * with an ISO 4217 code beside them. Nothing is estimated and nothing is
 * converted. A summary covers one currency and reports how many recorded
 * amounts it had to leave out, because a converted figure would be invented
 * precision (PRODUCT.md principle 3).
 *
 * Both summaries are Pro-only at the resolver (null for Free, never zeros:
 * "$0 per hour" would be a false fact rather than an absent one). The hours
 * that divide the money are the same lifetime and ride counters the rest of
 * the product shows, so cost per hour is explainable from numbers the rider
 * can already see.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_CURRENCY } from '@loam/shared';
import {
  componentWindowsForBike,
  serviceLogWhereForWindows,
  windowContaining,
} from './component-history';

type Db = PrismaClient | Prisma.TransactionClient;

/** A part's cost per hour is meaningless under one hour of riding. */
const MIN_HOURS_FOR_RATE = 1;

export interface ComponentCostSummary {
  currency: string;
  purchaseMinor: number | null;
  serviceMinor: number;
  totalMinor: number;
  lifetimeHours: number;
  perHourMinor: number | null;
  otherCurrencyCount: number;
}

export interface BikeCostYear {
  year: number;
  partsMinor: number;
  serviceMinor: number;
}

export interface BikeCostSummary {
  currency: string;
  bikeMinor: number | null;
  partsMinor: number;
  serviceMinor: number;
  totalMinor: number;
  rideHours: number;
  perHourMinor: number | null;
  byYear: BikeCostYear[];
  otherCurrencyCount: number;
}

const perHour = (totalMinor: number, hours: number): number | null =>
  hours >= MIN_HOURS_FOR_RATE ? totalMinor / hours : null;

/**
 * Which currency a summary is in: the rider's Settings currency when they set
 * one, otherwise the first currency among the amounts, otherwise the default.
 * An amount stored without a code (never written by the API, but the column
 * is nullable) is read as the summary's currency rather than dropped.
 */
export function pickCurrency(
  preferred: string | null | undefined,
  seen: Array<string | null | undefined>
): string {
  if (preferred) return preferred;
  for (const code of seen) if (code) return code;
  return DEFAULT_CURRENCY;
}

const inCurrency = (code: string | null | undefined, currency: string): boolean =>
  code == null || code === currency;

export async function componentCostSummary(
  db: Db,
  component: {
    id: string;
    purchasePriceMinor: number | null;
    purchaseCurrency: string | null;
    lifetimeHours: number;
    hoursUsed: number;
    priorHours: number;
    countersComputedAt: Date | null;
  },
  preferredCurrency: string | null | undefined
): Promise<ComponentCostSummary> {
  const logs = await db.serviceLog.findMany({
    where: { componentId: component.id, kind: 'SERVICE', costMinor: { not: null } },
    select: { costMinor: true, currency: true },
  });

  const currency = pickCurrency(preferredCurrency, [
    component.purchasePriceMinor != null ? component.purchaseCurrency : null,
    ...logs.map((l) => l.currency),
  ]);

  let otherCurrencyCount = 0;
  let purchaseMinor: number | null = null;
  if (component.purchasePriceMinor != null) {
    if (inCurrency(component.purchaseCurrency, currency)) purchaseMinor = component.purchasePriceMinor;
    else otherCurrencyCount += 1;
  }
  let serviceMinor = 0;
  for (const log of logs) {
    if (log.costMinor == null) continue;
    if (inCurrency(log.currency, currency)) serviceMinor += log.costMinor;
    else otherCurrencyCount += 1;
  }

  // Rows that predate the derived counters still hold 0 in lifetimeHours; the
  // legacy figure (hoursUsed plus declared prior hours) is the honest fallback,
  // matching how the rest of the API reads such rows.
  const lifetimeHours =
    component.countersComputedAt == null
      ? component.hoursUsed + component.priorHours
      : component.lifetimeHours;

  const totalMinor = (purchaseMinor ?? 0) + serviceMinor;
  return {
    currency,
    purchaseMinor,
    serviceMinor,
    totalMinor,
    lifetimeHours,
    perHourMinor: perHour(totalMinor, lifetimeHours),
    otherCurrencyCount,
  };
}

export async function bikeCostSummary(
  db: Db,
  bike: { id: string; userId: string; purchasePriceMinor: number | null; purchaseCurrency: string | null },
  preferredCurrency: string | null | undefined,
  now: Date = new Date()
): Promise<BikeCostSummary> {
  const windows = await componentWindowsForBike(db, bike.id, bike.userId, now);
  const componentIds = [...new Set(windows.map((w) => w.componentId))];
  const serviceWhere = serviceLogWhereForWindows(windows);

  const [components, logs, rideAgg] = await Promise.all([
    componentIds.length
      ? db.component.findMany({
          where: { id: { in: componentIds }, userId: bike.userId },
          select: { id: true, isStock: true, purchasePriceMinor: true, purchaseCurrency: true },
        })
      : Promise.resolve([]),
    serviceWhere
      ? db.serviceLog.findMany({
          where: { AND: [serviceWhere, { kind: 'SERVICE', costMinor: { not: null } }] },
          select: { componentId: true, performedAt: true, costMinor: true, currency: true },
        })
      : Promise.resolve([]),
    // Duplicates are not credited to component hours, so they do not count
    // here either: the same ride set the bike's counters are built from.
    db.ride.aggregate({
      where: { bikeId: bike.id, userId: bike.userId, isDuplicate: false },
      _sum: { durationSeconds: true },
    }),
  ]);

  const currency = pickCurrency(preferredCurrency, [
    bike.purchasePriceMinor != null ? bike.purchaseCurrency : null,
    ...components.map((c) => (c.purchasePriceMinor != null ? c.purchaseCurrency : null)),
    ...logs.map((l) => l.currency),
  ]);

  let otherCurrencyCount = 0;
  let bikeMinor: number | null = null;
  if (bike.purchasePriceMinor != null) {
    if (inCurrency(bike.purchaseCurrency, currency)) bikeMinor = bike.purchasePriceMinor;
    else otherCurrencyCount += 1;
  }

  const years = new Map<number, BikeCostYear>();
  const yearOf = (d: Date) => d.getUTCFullYear();
  const bucket = (year: number): BikeCostYear => {
    let y = years.get(year);
    if (!y) {
      y = { year, partsMinor: 0, serviceMinor: 0 };
      years.set(year, y);
    }
    return y;
  };

  // A stock part came with the bike, so its price is the bike's price. A part
  // bought separately counts in the year it first went on this bike.
  let partsMinor = 0;
  for (const c of components) {
    if (c.isStock || c.purchasePriceMinor == null) continue;
    if (!inCurrency(c.purchaseCurrency, currency)) {
      otherCurrencyCount += 1;
      continue;
    }
    partsMinor += c.purchasePriceMinor;
    const first = windows
      .filter((w) => w.componentId === c.id)
      .reduce<Date | null>((acc, w) => (acc == null || w.start < acc ? w.start : acc), null);
    if (first) bucket(yearOf(first)).partsMinor += c.purchasePriceMinor;
  }

  let serviceMinor = 0;
  for (const log of logs) {
    if (log.costMinor == null) continue;
    // The where clause already matched a window; re-check so a log is counted
    // once even when a component has overlapping windows on this bike.
    if (!windowContaining(windows, log.componentId, log.performedAt)) continue;
    if (!inCurrency(log.currency, currency)) {
      otherCurrencyCount += 1;
      continue;
    }
    serviceMinor += log.costMinor;
    bucket(yearOf(log.performedAt)).serviceMinor += log.costMinor;
  }

  const rideHours = (rideAgg._sum.durationSeconds ?? 0) / 3600;
  const totalMinor = (bikeMinor ?? 0) + partsMinor + serviceMinor;
  return {
    currency,
    bikeMinor,
    partsMinor,
    serviceMinor,
    totalMinor,
    rideHours,
    perHourMinor: perHour(totalMinor, rideHours),
    byYear: [...years.values()].sort((a, b) => b.year - a.year),
    otherCurrencyCount,
  };
}

/**
 * The plain spend total a bike history page shows every tier: the sum of the
 * listed services' costs in one currency, and how many were in another.
 */
export function sumServiceSpend(
  logs: Array<{ costMinor: number | null; currency: string | null }>,
  preferredCurrency: string | null | undefined
): { spendMinor: number | null; spendCurrency: string | null; spendOtherCurrencyCount: number } {
  const priced = logs.filter((l) => l.costMinor != null);
  if (priced.length === 0) return { spendMinor: null, spendCurrency: null, spendOtherCurrencyCount: 0 };
  const currency = pickCurrency(preferredCurrency, priced.map((l) => l.currency));
  let spendMinor = 0;
  let other = 0;
  for (const l of priced) {
    if (inCurrency(l.currency, currency)) spendMinor += l.costMinor as number;
    else other += 1;
  }
  return { spendMinor, spendCurrency: currency, spendOtherCurrencyCount: other };
}
