/**
 * Fetch just the recording device for a Strava activity.
 *
 * Strava's activity list and backfill endpoints omit `device_name`; only the
 * detailed activity (GET /activities/{id}) carries it. We capture it so a ride
 * recorded on a Garmin device and imported via Strava can still be attributed to
 * Garmin, which the Garmin Developer API Brand Guidelines require wherever
 * Garmin device-sourced data is present.
 *
 * Best-effort by design: a rate-limited or failed lookup returns null and the
 * ride still imports, falling back to no Garmin attribution until a later sync
 * (webhook delivery or latest-sync) fills it in.
 */
export async function fetchStravaDeviceName(
  accessToken: string,
  activityId: number | string
): Promise<string | null> {
  try {
    const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const detail = (await res.json()) as { device_name?: string | null };
    return detail.device_name ?? null;
  } catch {
    return null;
  }
}
