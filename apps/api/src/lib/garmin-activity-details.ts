import { logger } from './logger';

/**
 * Reader for the payload behind a Garmin ping's callbackURL.
 *
 * WHY THIS EXISTS, and why it is not a URL builder.
 *
 * Garmin's PING service does not send activity data. It sends a notification
 * carrying a `callbackURL`, and the integration is expected to GET exactly that
 * URL. Partner Verification scores this: a pull is "prompted" only when it
 * matches a callbackURL Garmin issued. Anything the integration composes for
 * itself is an unprompted pull, and the ping it ignored is separately counted
 * as unanswered. One self-built request therefore fails two checks at once,
 * which is what the verification dashboard was showing.
 *
 * So this module never constructs a query. It takes the URL Garmin gave us and
 * reads what comes back. An earlier version of this file built
 * `/rest/activityDetails?uploadStartTimeInSeconds=...` as a fallback; that was
 * itself an unprompted pull and has been removed rather than made conditional.
 *
 * The response doubles as the map fix: when the ping is for the activityDetails
 * summary type, the payload carries `samples[]` alongside the stats, so one
 * prompted request yields the ride and its GPS track together. No second call,
 * prompted or otherwise, is needed.
 */

/** One entry from a callbackURL payload. Only the fields we route on are named. */
export type GarminActivityPayload = {
  summaryId?: string;
  activityId?: number | string;
  /** Per-point array; normalized by lib/garmin-streams. Absent on summary-only payloads. */
  samples?: unknown;
  [key: string]: unknown;
};

/**
 * Garmin appends a suffix to the details summaryId for some activity kinds
 * (e.g. `12345678-detail`), so an exact match alone misses them. Comparing the
 * leading id segment matches both spellings without matching a different
 * activity, since the ids themselves are opaque and unique.
 */
function idsMatch(candidate: string | undefined, summaryId: string): boolean {
  if (!candidate) return false;
  if (candidate === summaryId) return true;
  return candidate.split('-')[0] === summaryId.split('-')[0];
}

/**
 * Lift an entry's nested `summary` onto the top level.
 *
 * The two summary types are NOT the same shape. An `activities` payload returns
 * the stats flat: `activityType`, `startTimeInSeconds`, `distanceInMeters` are
 * all top-level keys. An `activityDetails` payload nests exactly those fields
 * under a `summary` object and puts `samples` beside it. Every consumer here was
 * written against the flat shape, so a details payload reaching them reads
 * `activity.activityType` as undefined and throws on the first `.toLowerCase()`.
 *
 * Flattening at the boundary means the ingest code stays shape-blind and one
 * upsert path serves both. A flat payload passes through untouched, so this is
 * safe to apply to any Garmin payload.
 */
export function flattenGarminActivity<T extends Record<string, unknown>>(activity: T): T {
  const summary = activity.summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return activity;
  // Outer keys win: summaryId and userId live at the top level and must not be
  // shadowed by anything of the same name inside the nested summary.
  return { ...(summary as Record<string, unknown>), ...activity } as T;
}

/**
 * GET a ping's callbackURL and return the entry for one activity, flattened.
 *
 * Answering the ping is the point: this request is what Garmin's verification
 * counts as prompted, and what stops the ping being logged as unanswered. The
 * activity data is the by-product.
 *
 * Best-effort by contract. The caller decides what a null means, because at the
 * ping stage there is no ride yet and failing loudly would just burn the job's
 * retries against an endpoint that already answered.
 *
 * Returns null rather than guessing when nothing in the response matches the
 * summaryId. A callbackURL covers an upload window and can legitimately carry
 * several activities, and attaching another ride's data to this one is worse
 * than importing nothing.
 */
export async function fetchGarminActivityFromCallback(opts: {
  accessToken: string;
  summaryId: string;
  callbackURL: string;
}): Promise<GarminActivityPayload | null> {
  try {
    const response = await fetch(opts.callbackURL, {
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(
        {
          event: 'garmin_callback_fetch_failed',
          summaryId: opts.summaryId,
          status: response.status,
          response: text.slice(0, 500),
        },
        '[GarminCallback] Ping callbackURL fetch failed'
      );
      return null;
    }

    const body = (await response.json()) as GarminActivityPayload[] | GarminActivityPayload;
    const entries = (Array.isArray(body) ? body : [body]).map(flattenGarminActivity);

    const match = entries.find(
      (entry) =>
        idsMatch(entry.summaryId, opts.summaryId) ||
        idsMatch(entry.activityId != null ? String(entry.activityId) : undefined, opts.summaryId)
    );

    if (!match) {
      logger.info(
        {
          event: 'garmin_callback_no_match',
          summaryId: opts.summaryId,
          returned: entries.length,
        },
        '[GarminCallback] No entry in the callback payload matched this activity'
      );
      return null;
    }

    return match;
  } catch (err) {
    logger.warn(
      { event: 'garmin_callback_fetch_error', summaryId: opts.summaryId, err },
      '[GarminCallback] Ping callbackURL fetch threw'
    );
    return null;
  }
}
