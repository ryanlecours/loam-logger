/**
 * Suunto API Type Definitions
 *
 * Suunto CloudAPI workouts carry a numeric `activityId` that encodes the sport.
 * Only a subset of IDs are cycling — the rest (running, swimming, etc.) should
 * not become rides in Loam Logger.
 *
 * Activity IDs are documented in Suunto's public API reference; only the
 * cycling-related IDs we consume are declared here. Extend this list if Suunto
 * adds new cycling sub-types (e.g. gravel, BMX) that we want to track.
 */

/**
 * Suunto activity IDs that represent cycling.
 *
 * - 2:  Cycling (road / general)
 * - 10: Mountain biking
 * - 37: Indoor cycling (trainer / spin class)
 */
export const SUUNTO_CYCLING_ACTIVITY_IDS = [2, 10, 37] as const;

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
    case 10:
      return 'Mountain Bike';
    case 37:
      return 'Indoor Cycling';
    case 2:
    default:
      return 'Cycling';
  }
}
