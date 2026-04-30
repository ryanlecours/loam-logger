/**
 * Suunto API Type Definitions
 *
 * Suunto CloudAPI workouts carry a numeric `activityId` that encodes the sport.
 * Only a subset of IDs are cycling — the rest (running, swimming, etc.) should
 * not become rides in Loam Logger.
 *
 * Source of truth: Suunto's official activity ID reference
 * https://aspartnercontent.blob.core.windows.net/apizone/docs/Activities.pdf
 * When Suunto adds new cycling sub-types, add the ID here and to
 * `getSuuntoRideType` below.
 */

/**
 * Suunto activity IDs that represent cycling.
 *
 * Pulled from the FIT-file mapping table where `sport` is either `CYCLING`
 * or `E_BIKING` (e-bikes get their own FIT sport but are still rides from
 * our perspective, same as [backfill.worker.ts GARMIN_CYCLING_TYPES]).
 *
 * - 2:   Cycling (road / general)
 * - 10:  Mountain biking
 * - 52:  Indoor cycling (trainer / spin class)
 * - 99:  Gravel cycling
 * - 105: E-biking
 * - 106: E-MTB
 * - 109: Hand cycling
 * - 114: Cyclocross
 */
export const SUUNTO_CYCLING_ACTIVITY_IDS = [2, 10, 52, 99, 105, 106, 109, 114] as const;

type SuuntoCyclingActivityId = (typeof SUUNTO_CYCLING_ACTIVITY_IDS)[number];

/**
 * True if the given Suunto activity ID is one of our tracked cycling sports.
 */
export function isSuuntoCyclingActivity(activityId: number): boolean {
  return SUUNTO_CYCLING_ACTIVITY_IDS.includes(
    activityId as SuuntoCyclingActivityId
  );
}

/**
 * Canonical ride type label for a Suunto cycling activity. Callers should only
 * invoke this after `isSuuntoCyclingActivity` returns true; unknown activity
 * IDs fall back to the generic "Cycling" label.
 */
export function getSuuntoRideType(activityId: number): string {
  switch (activityId) {
    case 10:  return 'Mountain Bike';
    case 52:  return 'Indoor Cycling';
    case 99:  return 'Gravel';
    case 105: return 'E-Bike';
    case 106: return 'E-Mountain Bike';
    case 109: return 'Hand Cycling';
    case 114: return 'Cyclocross';
    case 2:
    default:  return 'Cycling';
  }
}

/**
 * The full set of Suunto activity IDs documented in Activities.pdf as of the
 * 2026-04-30 fetch. Used to distinguish "known non-cycling" (e.g. running,
 * swimming — silently ignored at info level) from "unknown" (Suunto added a
 * new sport since this list was last refreshed — surfaced at warn level so
 * we know to evaluate it for the cycling whitelist).
 *
 * Range is 0-121 with a gap at 89 (the PDF jumps from 88 Paragliding straight
 * to 90 Snorkeling). When Suunto extends Activities.pdf, append new IDs here
 * AND consider whether the new ID should also join SUUNTO_CYCLING_ACTIVITY_IDS.
 */
const KNOWN_SUUNTO_ACTIVITY_IDS: ReadonlySet<number> = new Set(
  // 0..88 inclusive, then 90..121 inclusive (89 is unused in the catalog).
  [
    ...Array.from({ length: 89 }, (_, i) => i),       // 0..88
    ...Array.from({ length: 32 }, (_, i) => 90 + i),  // 90..121
  ],
);

/**
 * True if the given Suunto activity ID appears anywhere in Suunto's catalog.
 * Used by ingestion paths to differentiate "this is a known sport we don't
 * import" (e.g. running) from "this is a sport we've never heard of" — the
 * latter is a signal that Suunto's catalog has drifted and our whitelist
 * needs review.
 */
export function isKnownSuuntoActivity(activityId: number): boolean {
  return KNOWN_SUUNTO_ACTIVITY_IDS.has(activityId);
}

/**
 * Extracts deduped activity IDs that are neither cycling nor in the known
 * Suunto catalog — i.e. evidence that Suunto added a sport since the last
 * Activities.pdf review. Callers (sync worker, backfill worker, backfill
 * route) feed the result into a logger.warn at their own log prefix; the
 * empty array means "no drift detected."
 *
 * Dedupe matters: a sync of 100 workouts of the same unknown sport should
 * produce one warn, not 100. Centralizing the predicate also means future
 * additions (a metric counter, Sentry breadcrumb, etc.) are a one-line
 * change instead of three.
 */
export function detectUnknownSuuntoActivityIds(
  workouts: { activityId: number }[],
): number[] {
  return Array.from(
    new Set(
      workouts
        .filter(
          (w) =>
            !isSuuntoCyclingActivity(w.activityId) &&
            !isKnownSuuntoActivity(w.activityId),
        )
        .map((w) => w.activityId),
    ),
  );
}
