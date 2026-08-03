/**
 * Fetch just the recording device for a Strava activity.
 *
 * Strava's activity list and backfill endpoints omit `device_name`; only the
 * detailed activity (GET /activities/{id}) carries it. We capture it so a ride
 * recorded on a Garmin device and imported via Strava can still be attributed to
 * Garmin, which the Garmin Developer API Brand Guidelines require wherever
 * Garmin device-sourced data is present.
 *
 * Best-effort by design: a rate-limited, failed, slow, or malformed lookup
 * returns null and the ride still imports, falling back to no Garmin attribution
 * until a later sync (webhook delivery or latest-sync) fills it in.
 *
 * QUOTA TRADEOFF (deliberate): callers invoke this once per NEW activity only,
 * both the backfill route and latest-sync skip already-imported rides, so no ride
 * is re-fetched. A large first-time backfill can still issue hundreds of these
 * sequentially, and Strava's rate limit is enforced per-application (shared
 * across all users), so a burst of big backfills eats into the shared 15-minute
 * and daily quotas. That is an accepted cost for attributing imported history;
 * the timeout below bounds per-call latency, and the null fallback keeps a
 * throttled lookup from failing the import. If this pressure becomes a problem,
 * the next step is to batch/throttle here (or drop backfill capture and rely on
 * the webhook path, which already has the detail in hand for free).
 */

// Bounds a single lookup so a stalled Strava endpoint can't hold a backfill
// request or a sync-worker job open for the HTTP client's (long) default.
const STRAVA_DEVICE_FETCH_TIMEOUT_MS = 5000;

export async function fetchStravaDeviceName(
  accessToken: string,
  activityId: number | string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STRAVA_DEVICE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const detail = (await res.json()) as { device_name?: string | null };
    return detail.device_name ?? null;
  } catch {
    // Network error, abort/timeout, or bad JSON — never block or fail the caller.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
