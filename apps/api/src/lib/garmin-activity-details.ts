import { logger } from './logger';

/**
 * Fetcher for Garmin's Activity Details, the only endpoint that carries GPS.
 *
 * Garmin splits one activity across two summary types. `/rest/activities`
 * returns the Activity Summary: duration, distance, elevation, HR, device,
 * start coords, and nothing per-point. The `samples[]` array with
 * latitude/longitude/elevation per second lives only in Activity Details,
 * `/rest/activityDetails`. Pulling the summary and looking for `samples` on it
 * therefore always finds nothing, which is why Garmin rides had no map: the
 * normalizer and the store were both correct and simply never fed.
 *
 * COMPLIANCE: the Connect Developer Program forbids *unprompted* pulls. Every
 * call here is prompted. It happens in direct response to an activity ping,
 * using the callbackURL Garmin sent us or the upload window that ping named.
 * There is no polling path and no way to reach this from a user action.
 * `callbackURL` is preferred whenever Garmin supplied one: it is already scoped
 * to exactly the notified activities, so it needs no window arithmetic and
 * cannot drift.
 */

const DEFAULT_API_BASE = 'https://apis.garmin.com/wellness-api';

/**
 * Widening applied on each side of a ping's `uploadTimestampInSeconds` when no
 * callbackURL was supplied. Garmin filters this endpoint on UPLOAD time, not
 * start time, and the ping's timestamp is the upload instant, so the window
 * only has to absorb clock skew and the truncation to whole seconds rather
 * than the length of the ride.
 */
const UPLOAD_WINDOW_PADDING_SECONDS = 60;

/** One Activity Details entry. Only the fields we route on are named. */
export type GarminActivityDetails = {
  summaryId?: string;
  activityId?: number | string;
  /** Per-point array; normalized by lib/garmin-streams. Absent for indoor rides. */
  samples?: unknown;
  [key: string]: unknown;
};

/**
 * Garmin appends a suffix to the details summaryId for some activity kinds
 * (e.g. `12345678-detail`), so an exact match alone misses them. Comparing the
 * leading id segment matches both spellings without matching a different
 * activity, since the ids themselves are opaque and unique.
 */
function idsMatch(detailsId: string | undefined, summaryId: string): boolean {
  if (!detailsId) return false;
  if (detailsId === summaryId) return true;
  return detailsId.split('-')[0] === summaryId.split('-')[0];
}

function buildWindowUrl(apiBase: string, uploadTimestampInSeconds: number): string {
  const start = uploadTimestampInSeconds - UPLOAD_WINDOW_PADDING_SECONDS;
  const end = uploadTimestampInSeconds + UPLOAD_WINDOW_PADDING_SECONDS;
  return `${apiBase}/rest/activityDetails?uploadStartTimeInSeconds=${start}&uploadEndTimeInSeconds=${end}`;
}

/**
 * Lift an Activity Details entry's nested `summary` onto the top level.
 *
 * The two summary types are NOT the same shape. `/rest/activities` returns the
 * stats flat: `activityType`, `startTimeInSeconds`, `distanceInMeters` are all
 * top-level keys. `/rest/activityDetails` nests exactly those fields under a
 * `summary` object and puts `samples` beside it. Every consumer here was
 * written against the flat shape, so a details payload reaching them reads
 * `activity.activityType` as undefined and throws on the first `.toLowerCase()`.
 *
 * Flattening at the boundary means the ingest code stays shape-blind and one
 * upsert path serves both summary and details callbacks. A flat payload passes
 * through untouched, so this is safe to apply to any Garmin callback batch.
 */
export function flattenGarminActivity<T extends Record<string, unknown>>(activity: T): T {
  const summary = activity.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return activity;
  // Outer keys win: summaryId and userId live at the top level and must not be
  // shadowed by anything of the same name inside the nested summary.
  return { ...(summary as Record<string, unknown>), ...activity } as T;
}

/**
 * Resolve the Activity Details entry for one activity, or null.
 *
 * Best-effort by contract, exactly like persistGarminStream downstream: by the
 * time this runs the ride and its component hours are the primary data and are
 * already safe. A details fetch that fails costs the rider a map; throwing here
 * would cost them the ride. Every failure path logs and returns null.
 *
 * Returns null rather than guessing when nothing in the response matches the
 * summaryId. A window pull can legitimately return several activities, and
 * attaching another ride's GPS track to this one is far worse than no map.
 */
export async function fetchGarminActivityDetails(opts: {
  accessToken: string;
  summaryId: string;
  /** From the ping, when Garmin supplied one. Preferred over the window. */
  callbackURL?: string;
  /** From the ping. Used to build a window when there is no callbackURL. */
  uploadTimestampInSeconds?: number;
  apiBase?: string;
}): Promise<GarminActivityDetails | null> {
  const apiBase = opts.apiBase ?? process.env.GARMIN_API_BASE ?? DEFAULT_API_BASE;

  const url =
    opts.callbackURL ??
    (opts.uploadTimestampInSeconds != null
      ? buildWindowUrl(apiBase, opts.uploadTimestampInSeconds)
      : null);

  // No callbackURL and no upload timestamp means nothing prompted this fetch.
  // Inventing a window here would be exactly the unprompted pull the program
  // rules forbid, so decline instead.
  if (!url) {
    logger.debug(
      { summaryId: opts.summaryId },
      '[GarminDetails] No callbackURL or upload timestamp; skipping details fetch'
    );
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(
        {
          event: 'garmin_details_fetch_failed',
          summaryId: opts.summaryId,
          status: response.status,
          usedCallbackUrl: opts.callbackURL != null,
          response: text.slice(0, 500),
        },
        '[GarminDetails] Activity Details fetch failed; ride keeps its stats, loses its map'
      );
      return null;
    }

    const body = (await response.json()) as GarminActivityDetails[] | GarminActivityDetails;
    const entries = Array.isArray(body) ? body : [body];

    const match = entries.find(
      (entry) =>
        idsMatch(entry.summaryId, opts.summaryId) ||
        idsMatch(entry.activityId != null ? String(entry.activityId) : undefined, opts.summaryId)
    );

    if (!match) {
      logger.info(
        {
          event: 'garmin_details_no_match',
          summaryId: opts.summaryId,
          returned: entries.length,
        },
        '[GarminDetails] No Activity Details entry matched this activity'
      );
      return null;
    }

    return match;
  } catch (err) {
    logger.warn(
      { event: 'garmin_details_fetch_error', summaryId: opts.summaryId, err },
      '[GarminDetails] Activity Details fetch threw; ride is unaffected'
    );
    return null;
  }
}
