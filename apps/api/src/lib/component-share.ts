import type { Component, ComponentShare, ComponentShareScope, PrismaClient } from '@prisma/client';
import {
  aggregateLifetime,
  buildCountedRideWhere,
  cumulativeSeries,
  emptyTotals,
  mergeWindows,
  normalizeTenures,
  TENURE_CAP,
  type DateRange,
  type NormalizedTenure,
  type UsageTotals,
} from './component-history';

// ---------------------------------------------------------------------------
// Component share links
// ---------------------------------------------------------------------------
//
// A share link shows one window of a component's history to anyone holding the
// URL (loamlogger.app/share/component/<slug>). Each link is locked to its scope,
// so a rider who shares "since last service" does not also hand over the part's
// lifetime:
//
//   LIFETIME       everything on record, live
//   SINCE_SERVICE  from the latest SERVICE log on, live (it moves when the
//                  rider logs a new service)
//   RANGE          a fixed [rangeStart, rangeEnd) window
//
// The page is public and unauthenticated, so the payload is built from an
// explicit allowlist: no notes, no owner identity, no bike nicknames or ids, no
// per-ride rows and no weather. Weather is Pro-gated in Ride.weather, and a
// date-windowed aggregate of it would let anyone narrow the window down to
// single rides.

/** Links per component. A share is a click; this only bounds link sprawl. */
export const MAX_SHARES_PER_COMPONENT = 20;

/**
 * Slack on the date checks, so a rider far from UTC can pick their own install
 * day or today without tripping the server's bounds. The date picker enforces
 * the exact limits.
 */
const DATE_SLACK_MS = 24 * 60 * 60 * 1000;

/** The date a component started its life on record: its earliest tenure. */
export function componentStartDate(
  tenures: Array<Pick<NormalizedTenure, 'start'>>,
  component: Pick<Component, 'installedAt' | 'createdAt'>
): Date {
  const earliest = tenures.reduce<Date | null>(
    (min, t) => (min === null || t.start < min ? t.start : min),
    null
  );
  return earliest ?? component.installedAt ?? component.createdAt;
}

/**
 * Check a requested RANGE against the component's life: no earlier than its
 * install date and no later than today. Returns an error message, or null when
 * the range is acceptable.
 */
export function rangeError(params: {
  start: Date;
  end: Date;
  startDate: Date;
  now: Date;
}): string | null {
  const { start, end, startDate, now } = params;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Invalid date';
  if (end <= start) return 'The end date must be after the start date';
  if (start.getTime() < startDate.getTime() - DATE_SLACK_MS) {
    return 'The range cannot start before the component was installed';
  }
  if (end.getTime() > now.getTime() + DATE_SLACK_MS) return 'The range cannot end after today';
  return null;
}

/** The window a link shows right now. */
export function shareWindow(
  share: Pick<ComponentShare, 'scope' | 'rangeStart' | 'rangeEnd'>,
  latestServiceAt: Date | null
): DateRange {
  switch (share.scope) {
    case 'LIFETIME':
      return { start: null, end: null };
    case 'SINCE_SERVICE':
      // Never serviced: every ride counts, as on the owner's page.
      return { start: latestServiceAt, end: null };
    case 'RANGE':
      return { start: share.rangeStart, end: share.rangeEnd };
  }
}

const inWindow = (at: Date, w: DateRange) =>
  (!w.start || at >= w.start) && (!w.end || at < w.end);

const toTotals = (t: UsageTotals) => ({
  rideCount: t.rideCount,
  durationSeconds: Math.round(t.durationSeconds),
  distanceMeters: t.distanceMeters,
  elevationGainMeters: t.elevationGainMeters,
  firstRideAt: t.firstRideAt ? t.firstRideAt.toISOString() : null,
  lastRideAt: t.lastRideAt ? t.lastRideAt.toISOString() : null,
});

/**
 * The public payload for one share link. Read-only: unlike the owner's page it
 * never recomputes counters, because an unauthenticated request must not write.
 */
export async function buildSharedComponentHistory(
  db: PrismaClient,
  share: ComponentShare & { component: Component }
) {
  const { component } = share;
  const userId = component.userId;
  const componentId = component.id;

  const [adjustments, installRows, serviceLogs] = await Promise.all([
    db.componentRideAdjustment.findMany({
      where: { componentId },
      select: { rideId: true, kind: true },
    }),
    db.bikeComponentInstall.findMany({
      where: { componentId, userId },
      orderBy: [{ installedAt: 'asc' }, { id: 'asc' }],
      take: TENURE_CAP,
      select: { id: true, bikeId: true, slotKey: true, installedAt: true, removedAt: true },
    }),
    db.serviceLog.findMany({
      where: { componentId },
      orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
      // Explicit select, so freeform notes never leave the database on this path.
      select: {
        performedAt: true,
        kind: true,
        hoursAtService: true,
        serviceExtensionHours: true,
      },
    }),
  ]);
  const includedRideIds = adjustments.filter((a) => a.kind === 'INCLUDE').map((a) => a.rideId);
  const excludedRideIds = adjustments.filter((a) => a.kind === 'EXCLUDE').map((a) => a.rideId);

  const { tenures } = normalizeTenures(
    {
      id: component.id,
      userId,
      bikeId: component.bikeId,
      installedAt: component.installedAt,
      createdAt: component.createdAt,
      retiredAt: component.retiredAt,
      hoursUsed: component.hoursUsed,
    },
    installRows
  );

  // An inspection that stood in for a service moves the due point, not the date
  // of the last service.
  const latestServiceAt = serviceLogs.find((l) => l.kind === 'SERVICE')?.performedAt ?? null;
  const range = shareWindow(share, latestServiceAt);

  const aggregate = await aggregateLifetime(db, {
    userId,
    tenures,
    includedRideIds,
    excludedRideIds,
    range,
  });
  const cumulative = await cumulativeSeries(db, {
    userId,
    windows: mergeWindows(tenures),
    includedRideIds,
    excludedRideIds,
    range,
  });

  // Hours follow the owner's page: lifetime and since-service read the stored
  // counters, which carry declared pre-Loam hours and declared readings that no
  // ride accounts for. A fixed range has no counter, so it sums its rides.
  const computed = component.countersComputedAt != null;
  const declaredPriorHours =
    share.scope === 'LIFETIME' || (share.scope === 'SINCE_SERVICE' && !latestServiceAt)
      ? component.priorHours
      : 0;
  const totals = toTotals(aggregate.lifetime);
  if (computed && share.scope === 'LIFETIME') {
    totals.durationSeconds = Math.round(component.lifetimeHours * 3600);
  } else if (computed && share.scope === 'SINCE_SERVICE') {
    totals.durationSeconds = Math.round(component.hoursSinceService * 3600);
  } else if (declaredPriorHours > 0) {
    totals.durationSeconds += Math.round(declaredPriorHours * 3600);
  }

  // Only the tenures that overlap the window, with their share of it.
  const overlapping = tenures.filter(
    (t) => (!range.end || t.start < range.end) && (!range.start || t.end > range.start)
  );
  const bikeIds = [...new Set(overlapping.map((t) => t.bikeId))];
  const bikes = bikeIds.length
    ? await db.bike.findMany({
        where: { id: { in: bikeIds }, userId },
        // No nickname: riders name bikes after themselves.
        select: { id: true, manufacturer: true, model: true, year: true, thumbnailUrl: true },
      })
    : [];
  const bikeById = new Map(bikes.map((b) => [b.id, b]));

  // Which providers fed these numbers. The page is public, so the Garmin API
  // Brand Guidelines' downstream rule applies: attribution travels with the data.
  const rideWhere = buildCountedRideWhere({
    userId,
    windows: mergeWindows(tenures),
    includedRideIds,
    excludedRideIds,
    range,
  });
  const probe = (field: 'garminActivityId' | 'stravaActivityId' | 'whoopWorkoutId' | 'suuntoWorkoutId') =>
    rideWhere
      ? db.ride.findFirst({ where: { AND: [rideWhere, { [field]: { not: null } }] }, select: { id: true } })
      : Promise.resolve(null);
  const [strava, garmin, whoop, suunto] = await Promise.all([
    probe('stravaActivityId'),
    probe('garminActivityId'),
    probe('whoopWorkoutId'),
    probe('suuntoWorkoutId'),
  ]);

  return {
    component: {
      // The legacy WHEELS value reads as WHEEL_HUBS, as Component.type does.
      type: (component.type as string) === 'WHEELS' ? 'WHEEL_HUBS' : component.type,
      location: component.location ?? 'NONE',
      brand: component.brand,
      model: component.model,
      isStock: component.isStock,
    },
    scope: share.scope as ComponentShareScope,
    windowStart: range.start ? range.start.toISOString() : null,
    windowEnd: range.end ? range.end.toISOString() : null,
    totals,
    declaredPriorHours,
    bikes: overlapping.map((t) => {
      const bike = bikeById.get(t.bikeId);
      return {
        bike: bike
          ? { manufacturer: bike.manufacturer, model: bike.model, year: bike.year, thumbnailUrl: bike.thumbnailUrl }
          : null,
        installedAt: t.start.toISOString(),
        removedAt: t.removedAt ? t.removedAt.toISOString() : null,
        totals: toTotals(aggregate.perTenure.get(t.id) ?? emptyTotals()),
      };
    }),
    logbook: serviceLogs
      .filter((l) => inWindow(l.performedAt, range))
      .map((l) => ({
        performedAt: l.performedAt.toISOString(),
        kind: l.kind,
        hoursAtService: l.hoursAtService,
        serviceExtensionHours: l.serviceExtensionHours,
      })),
    cumulative: cumulative.map((p) => ({
      date: p.date.toISOString(),
      cumulativeHours: p.cumulativeHours,
      cumulativeDistanceMeters: p.cumulativeDistanceMeters,
      cumulativeElevationGainMeters: p.cumulativeElevationGainMeters,
    })),
    contributingSources: [
      strava ? 'strava' : null,
      garmin ? 'garmin' : null,
      whoop ? 'whoop' : null,
      suunto ? 'suunto' : null,
    ].filter((s): s is string => s !== null),
  };
}
