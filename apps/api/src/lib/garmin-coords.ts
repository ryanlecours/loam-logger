// Garmin start-coordinate extraction.
//
// Garmin's Activity Summary carries the ride's start position under
// `startingLatitudeInDegrees` / `startingLongitudeInDegrees` (see Garmin's
// "Activity Summary Export Format"). An earlier version of the ingestion code
// read `startLatitudeInDegrees` (missing the "ing") and the Strava-style
// `beginLatitude` / `beginLongitude` — names Garmin never sends. With the
// activity type's `[key: string]: unknown` index signature, those bad reads
// compiled fine and silently produced `undefined` for every Garmin ride, so
// coords were always null. That skipped both weather enrichment (the weather
// worker bails on null coords) and reverse-geocoded location.
//
// We read the correct keys first and keep the legacy names as harmless
// fallbacks. Garmin's docs spell the suffix inconsistently ("…Degrees" in the
// JSON vs "…Degree" in the CSV export), so we accept both to avoid gambling on
// the exact casing.

const asFiniteNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export type GarminStartCoords = { lat: number | null; lng: number | null };

export function extractGarminStartCoords(
  activity: Record<string, unknown>
): GarminStartCoords {
  const lat =
    asFiniteNumber(activity.startingLatitudeInDegrees) ??
    asFiniteNumber(activity.startingLatitudeInDegree) ??
    asFiniteNumber(activity.startLatitudeInDegrees) ??
    asFiniteNumber(activity.beginLatitude);
  const lng =
    asFiniteNumber(activity.startingLongitudeInDegrees) ??
    asFiniteNumber(activity.startingLongitudeInDegree) ??
    asFiniteNumber(activity.startLongitudeInDegrees) ??
    asFiniteNumber(activity.beginLongitude);
  return { lat, lng };
}
