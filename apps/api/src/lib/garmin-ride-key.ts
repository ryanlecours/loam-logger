/**
 * The stable ride key for a Garmin activity.
 *
 * Garmin delivers one ride under two summary types. The Activity Summary
 * carries `summaryId: "9876543210"` and the stats. The Activity Details for the
 * same ride carries `"9876543210-detail"`, the same stats nested under
 * `summary`, and the `samples[]` that draw the map.
 *
 * Both describe one ride, so both must land on one row. Keying rides on the raw
 * summaryId meant the details delivery looked up an id no row had, so it
 * inserted a second ride and attached the GPS track to the copy: the rider saw
 * their ride twice, once with a map and once without, and the duplicate's hours
 * were counted against their components a second time.
 *
 * This is deliberately an exact suffix strip rather than "everything before the
 * first hyphen". Garmin's ids are opaque, and a leading-segment rule would fuse
 * two genuinely different activities into one row the moment an id carries a
 * hyphen of its own. Silently losing a ride is worse than duplicating one, so
 * the rule only removes the one suffix Garmin is known to append.
 */
const DETAILS_SUFFIX = '-detail';

/**
 * Normalize a Garmin summaryId to the id its ride is stored under.
 *
 * Idempotent: a summary id passes through untouched, so this is safe to apply
 * at every read and write of `Ride.garminActivityId`.
 */
export function garminRideKey(summaryId: string): string {
  return summaryId.endsWith(DETAILS_SUFFIX)
    ? summaryId.slice(0, -DETAILS_SUFFIX.length)
    : summaryId;
}
