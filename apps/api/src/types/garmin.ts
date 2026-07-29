/**
 * Shared shapes for Garmin Activity API deliveries.
 *
 * Garmin can deliver an activity three ways, and the same webhook endpoint
 * receives all of them keyed by summary type:
 *
 *  - PUSH: the full payload arrives in the request body. Nothing to fetch.
 *  - PING: a notification arrives carrying a `callbackURL` to GET.
 *  - Backfill: a callbackURL covering a window, delivered the same way.
 *
 * PUSH is the mode this integration targets, because a delivery we never have
 * to answer cannot be scored as an unprompted pull or an unanswered ping. The
 * other two remain handled so a portal change, or a summary type still set to
 * ping, degrades rather than breaks.
 */

/** Garmin activityType values that count as cycling for our purposes. */
export const GARMIN_CYCLING_TYPES = [
  'cycling',
  'bmx',
  'cyclocross',
  'downhill_biking',
  'e_bike_fitness',
  'e_bike_mountain',
  'e_enduro_mtb',
  'enduro_mtb',
  'gravel_cycling',
  'indoor_cycling',
  'mountain_biking',
  'recumbent_cycling',
  'road_biking',
  'track_cycling',
  'virtual_ride',
  'handcycling',
  'indoor_handcycling',
];

/**
 * Garmin spells activity types inconsistently across payloads (`MOUNTAIN_BIKING`,
 * `Mountain Biking`), so compare on a normalized form rather than the raw value.
 */
export function isGarminCyclingActivity(activityType: unknown): boolean {
  if (typeof activityType !== 'string') return false;
  return GARMIN_CYCLING_TYPES.includes(activityType.toLowerCase().replace(/\s+/g, '_'));
}

/** A delivery entry, before we know whether it is data or a pointer to data. */
export type GarminDeliveryEntry = {
  userId?: string;
  summaryId?: string;
  callbackURL?: string;
  uploadTimestampInSeconds?: number;
  activityType?: string;
  summary?: Record<string, unknown>;
  samples?: unknown;
  [key: string]: unknown;
};

/**
 * Does this entry carry the activity itself, rather than a pointer to it?
 *
 * A notification is small and structural: userId, summaryId, maybe a
 * callbackURL and an upload timestamp. A pushed activity carries the actual
 * measurements. `activityType` plus a duration is the cheapest thing that is
 * always present on real activity data and never on a notification, and it is
 * checked after flattening so an activityDetails payload (which nests those
 * fields under `summary`) reads the same as a flat activities payload.
 *
 * Deliberately not keyed on `samples`: an indoor ride pushes a full activity
 * with no GPS at all, and treating that as a notification would send us
 * fetching data Garmin had already handed us.
 */
export function isPushedGarminActivity(entry: GarminDeliveryEntry): boolean {
  if (!isGarminActivityTypePresent(entry)) return false;
  return entry.durationInSeconds != null || entry.startTimeInSeconds != null;
}

function isGarminActivityTypePresent(entry: GarminDeliveryEntry): boolean {
  return typeof entry.activityType === 'string' && entry.activityType.length > 0;
}
