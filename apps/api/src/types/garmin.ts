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
  activityType?: string;
  summary?: Record<string, unknown>;
  samples?: unknown;
  [key: string]: unknown;
};

/**
 * Does this entry carry the activity itself, rather than a pointer to it?
 *
 * A pushed activity carries measurements. `activityType` plus a duration or a
 * start time is the cheapest thing that is always present on real activity data,
 * and it is checked after flattening so an activityDetails payload (which nests
 * those fields under `summary`) reads the same as a flat activities payload.
 *
 * Deliberately not keyed on `samples`: an indoor ride pushes a full activity
 * with no GPS at all, and treating that as a notification would send us
 * fetching data Garmin had already handed us.
 *
 * A callbackURL DISQUALIFIES an entry, whatever else it carries. That rule is
 * here rather than in the caller's branch ordering on purpose, because getting
 * it wrong reproduces the exact bug this whole change exists to fix: an entry
 * misread as pushed is never followed, so its ping is scored unanswered again.
 * The real ping shape has not been observed yet, and some Garmin notifications
 * carry summary metadata alongside the URL, so the safe reading is that
 * anything offering a URL to follow is a notification.
 *
 * The asymmetry is deliberate. Misreading a push as a notification costs one
 * prompted request, which no verification check objects to. Misreading a
 * notification as a push costs an unanswered ping and a lost activity.
 */
export function isPushedGarminActivity(entry: GarminDeliveryEntry): boolean {
  if (hasCallbackUrl(entry)) return false;
  if (!isGarminActivityTypePresent(entry)) return false;
  return entry.durationInSeconds != null || entry.startTimeInSeconds != null;
}

/**
 * An entry that carries BOTH a callbackURL and measurements.
 *
 * Treated as a notification (see above), but worth surfacing: it would mean the
 * live ping shape differs from what this code was written against, and that is
 * the assumption most worth checking once real payloads are in hand.
 */
export function isAmbiguousGarminDelivery(entry: GarminDeliveryEntry): boolean {
  if (!hasCallbackUrl(entry)) return false;
  if (!isGarminActivityTypePresent(entry)) return false;
  return entry.durationInSeconds != null || entry.startTimeInSeconds != null;
}

function hasCallbackUrl(entry: GarminDeliveryEntry): boolean {
  return typeof entry.callbackURL === 'string' && entry.callbackURL.length > 0;
}

/**
 * Every key the ingest path actually reads off a Garmin activity.
 *
 * Grouped by who reads them so an addition has an obvious home:
 *  - identity and stats: upsertGarminActivity in workers/sync.worker
 *  - coordinates: extractGarminStartCoords in lib/garmin-coords, which accepts
 *    four spellings per axis because Garmin has shipped all of them. Every one
 *    has to survive the projection or a ride silently loses its start point,
 *    and with it weather enrichment. garmin.test.ts asserts that per key rather
 *    than trusting this list to stay in step.
 *  - track: normalizeGarminSamples in lib/garmin-streams
 */
const GARMIN_ACTIVITY_FIELDS = [
  'summaryId',
  'activityId',
  'activityType',
  'activityName',
  'startTimeInSeconds',
  'startTimeOffsetInSeconds',
  'durationInSeconds',
  'distanceInMeters',
  'elevationGainInMeters',
  'totalElevationGainInMeters',
  'averageHeartRateInBeatsPerMinute',
  'maxHeartRateInBeatsPerMinute',
  'locationName',
  'deviceName',
  'startingLatitudeInDegrees',
  'startingLatitudeInDegree',
  'startLatitudeInDegrees',
  'beginLatitude',
  'startingLongitudeInDegrees',
  'startingLongitudeInDegree',
  'startLongitudeInDegrees',
  'beginLongitude',
  'samples',
] as const;

/**
 * Reduce a delivery entry to the activity fields, discarding everything else.
 *
 * A pushed entry arrives in an unauthenticated webhook body and is then
 * persisted into BullMQ job data, which lives in Redis in plaintext. Passing
 * the raw entry through would put whatever the caller sent in there, and Garmin
 * itself sends `userAccessToken` in that body: a credential this integration
 * deliberately never uses, is careful to keep out of logs (lib/logger.ts
 * redaction), and encrypts at rest everywhere it does store one. Queueing it
 * would undo all three.
 *
 * An allowlist rather than a denylist of known-bad keys, because the entry type
 * carries an index signature: the set of fields we want is knowable and small,
 * the set someone might send is not.
 *
 * `samples` passes through as-is. It is the one large field, its shape is the
 * normalizer's business, and projecting thousands of points in the request
 * handler would trade a real latency cost against a credential risk that does
 * not apply inside it.
 */
export function pickGarminActivityFields(entry: GarminDeliveryEntry): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of GARMIN_ACTIVITY_FIELDS) {
    if (entry[field] !== undefined) picked[field] = entry[field];
  }
  return picked;
}

function isGarminActivityTypePresent(entry: GarminDeliveryEntry): boolean {
  return typeof entry.activityType === 'string' && entry.activityType.length > 0;
}
