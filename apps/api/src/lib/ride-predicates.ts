import type { Prisma } from '@prisma/client';

/**
 * The canonical "still waiting on a bike" predicate.
 *
 * `bikeId: null` on its own is NOT it. A demo, loaner or rental ride marked
 * `unownedBike` also has no bike, but by intent rather than omission, and
 * counting it as outstanding is what the flag exists to prevent.
 *
 * Kept as one constant because the two halves drifted the moment they were
 * written out by hand in more than one place: weatherBreakdown was left
 * matching on `bikeId` alone and swept unowned rides into totals that
 * `rides` and `unassignedRideCount` correctly excluded. Spread this rather
 * than restating it.
 *
 * Lives in lib/ (rather than resolvers.ts, where it started) so non-GraphQL
 * consumers — the weekly digest service — can share it without importing
 * the resolver module. The one copy this cannot cover is the raw SQL in
 * services/import-session-checker.service.ts, which spells the same
 * predicate out in its COUNT and has to be updated alongside.
 */
export const UNASSIGNED_RIDE_WHERE = { bikeId: null, unownedBike: false } as const;

/**
 * The providers a ride can be filtered by, in the priority order the clients
 * already use when a UI can only name one source (web's `getRideSource`,
 * mobile's ride row). Order is load-bearing here, not cosmetic: see
 * `providerRideWhere` below.
 */
export const RIDE_PROVIDERS = ['STRAVA', 'GARMIN', 'WHOOP', 'SUUNTO', 'MANUAL'] as const;

export type RideProvider = (typeof RIDE_PROVIDERS)[number];

/** The Ride column that proves a given provider supplied the activity. */
const PROVIDER_ID_COLUMN: Record<Exclude<RideProvider, 'MANUAL'>, string> = {
  STRAVA: 'stravaActivityId',
  GARMIN: 'garminActivityId',
  WHOOP: 'whoopWorkoutId',
  SUUNTO: 'suuntoWorkoutId',
};

/**
 * Rides belonging to exactly one provider bucket.
 *
 * Deliberately EXCLUSIVE, unlike attribution. A ride recorded on a Garmin and
 * imported through Strava carries data from both, and the badge UIs show both
 * because the Garmin API Brand Guidelines require attribution wherever that
 * data appears. A filter must not behave that way: overlapping buckets make
 * per-provider counts sum past the total, and a rider working through their
 * unassigned backlog one provider at a time would be shown the same ride twice.
 *
 * So each bucket claims a ride only if no higher-priority provider already
 * has: GARMIN means "has a Garmin activity and did not come via Strava", and
 * MANUAL means "no provider at all". The five buckets partition the set.
 */
export function providerRideWhere(provider: RideProvider): Prisma.RideWhereInput {
  const where: Record<string, null | { not: null }> = {};
  for (const candidate of RIDE_PROVIDERS) {
    if (candidate === 'MANUAL') continue;
    const column = PROVIDER_ID_COLUMN[candidate];
    if (candidate === provider) {
      where[column] = { not: null };
      return where;
    }
    // Outranks the requested provider, so its absence is part of the bucket.
    where[column] = null;
  }
  // MANUAL: fell through with every provider column pinned to null.
  return where;
}
