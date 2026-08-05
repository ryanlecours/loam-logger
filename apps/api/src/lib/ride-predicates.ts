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
