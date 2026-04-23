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
