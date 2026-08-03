/**
 * Garmin attribution strings and formatters.
 *
 * CANONICAL SOURCE for every Garmin-facing string in the product. Required by
 * the Garmin Developer API Brand Guidelines (v6.30.2025,
 * https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf),
 * which Garmin enforces as a condition of production API access:
 *
 *   "GARMIN RESERVES THE RIGHT TO REVIEW APPLICATIONS FOR ATTRIBUTION
 *    COMPLIANCE. NONCOMPLIANCE MAY RESULT IN SUSPENSION OR TERMINATION OF
 *    API ACCESS."
 *
 * The guidelines define four contexts, each with its own required treatment:
 *
 *  1. Title-level / primary displays (dashboards, activity feeds, overview
 *     cards, summary views) — "Garmin [device model]" beneath or adjacent to
 *     the primary title, above the fold. Never in tooltips, footnotes or
 *     expandable containers.
 *  2. Secondary screens (detail views, reports, settings, historical views) —
 *     same attribution in every expanded view. Multi-entry lists may attribute
 *     globally (a header) or per entry.
 *  3. Combined or derived data (analytics, algorithms, ML, AI, or blended with
 *     other sources) — Garmin listed as a distinct or contributing source,
 *     using one of the sanctioned phrasings below.
 *  4. Downstream / exported data (shares, exports, webhooks) — attribution
 *     adjacent to the data and preserved downstream.
 *
 * NOTE FOR MOBILE: loam-logger-mobile is a separate repo with no dependency on
 * @loam/shared, so it carries a hand-mirrored copy at
 * `src/constants/garminAttribution.ts`. Any edit here must be mirrored there in
 * the same session or the two apps drift out of compliance with each other.
 */

/**
 * The Garmin Connect app name. The guidelines are explicit under
 * AUTHENTICATING APPLICATIONS: "use the full app name and tile to display the
 * connection. Do not abbreviate, truncate or stylize the Garmin app name."
 *
 * Use this wherever the *connection or app* is named ("Connect Garmin
 * Connect™", "Sync from Garmin Connect™"). Do NOT use it as a data-source
 * attribution — that is what formatGarminSource() is for, since the data comes
 * from a device, not from the app.
 */
export const GARMIN_CONNECT_APP_NAME = 'Garmin Connect™';

/**
 * Sanctioned phrasing for charts and visualizations built from Garmin data.
 * Verbatim from the guidelines' "Acceptable" sample messaging under COMBINED
 * OR DERIVED DATA. Do not reword — the acceptable/unacceptable examples turn
 * on exact phrasing ("Garmin speed model" is called out as NOT acceptable
 * because it implies a Garmin-authored model).
 */
export const GARMIN_CHART_ATTRIBUTION =
  'This chart was created using data provided by Garmin devices.';

/**
 * Sanctioned phrasing for insights, predictions and any output influenced by
 * Garmin data — including anything routed through analytics, algorithms or AI.
 * Verbatim from the guidelines' "Acceptable" sample messaging.
 *
 * In Loam Logger this covers component wear hours, service predictions, bike
 * health status, and the LLM-generated maintenance summary — all of which are
 * materially influenced by Garmin-sourced ride duration.
 */
export const GARMIN_INSIGHT_ATTRIBUTION =
  'Insights derived in part from Garmin device-sourced data.';

/**
 * Trademark notice for downstream and publicly-shared surfaces. Garmin's own
 * standard form, as used in its product documentation.
 */
export const GARMIN_TRADEMARK_NOTICE =
  'Garmin® and the Garmin logo are trademarks of Garmin Ltd. or its subsidiaries, ' +
  'registered in the USA and other countries. Garmin Connect™ is a trademark of ' +
  'Garmin Ltd. or its subsidiaries.';

/**
 * Fallback source label when no device model is known. The guidelines permit
 * this explicitly: "If the device model is not provided or unknown via the API,
 * list Garmin as the data source."
 */
export const GARMIN_SOURCE_FALLBACK = 'Garmin';

/**
 * Placeholder device values Garmin sends when there is no real model. Seen in
 * practice on manually-entered and manually-edited activities: the "Manually
 * Updated Activities" webhook delivers `deviceName: "unknown"`. Treat these as
 * "no device" so we land on the sanctioned "Garmin" fallback, and so ingestion
 * never overwrites the real model captured on the first sync (that overwrite is
 * what flipped a ride's badge from "Garmin Fenix 8" to "Garmin Unknown" on the
 * next edit).
 */
const GARMIN_DEVICE_SENTINELS = new Set([
  'unknown',
  'unknown_device',
  'undefined',
  'null',
  'none',
]);

/**
 * Reduce a raw Garmin `deviceName` to a real model, or `undefined` for
 * non-strings, blank values, and the placeholder sentinels above. Ingestion
 * uses this to drop a sentinel (never storing it, never overwriting a known
 * model on a re-sync); formatGarminSource uses it so a sentinel already stored
 * on an older row still renders as plain "Garmin".
 */
export function normalizeGarminDeviceName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || GARMIN_DEVICE_SENTINELS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

/**
 * Turn a raw Garmin `deviceName` into something readable.
 *
 * Garmin reports device models as lowercase snake_case tokens ("edge_840",
 * "fenix7", "edge_1030_plus"). We only normalize separators and casing — we
 * never map to a curated display-name table, because a stale table would
 * silently mislabel new hardware, and mislabeling a device is worse under the
 * guidelines than showing the raw token. The unmodified value stays in
 * Ride.garminDeviceName regardless.
 *
 * Digit-bearing tokens ("fenix7", "edge_1030") are left as-is apart from
 * capitalization; splitting them heuristically risks inventing model names
 * Garmin does not use.
 */
export function humanizeGarminDevice(raw: string): string {
  return raw
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      // Preserve tokens that are already mixed-case or all-caps (e.g. "GPSMAP",
      // "MARQ") — re-casing them would stylize a Garmin product name.
      /[A-Z]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

/**
 * The attribution string to render wherever Garmin device-sourced data appears:
 * "Garmin Edge 840", or plain "Garmin" when the device is unknown.
 *
 * Accepts null/undefined/blank so callers can pass Ride.garminDeviceName
 * straight through without guarding — rides imported before device capture
 * existed, and activities Garmin reports without a device, both land on the
 * sanctioned fallback.
 */
export function formatGarminSource(deviceName?: string | null): string {
  const device = normalizeGarminDeviceName(deviceName);
  if (!device) return GARMIN_SOURCE_FALLBACK;

  const humanized = humanizeGarminDevice(device);
  if (!humanized) return GARMIN_SOURCE_FALLBACK;

  // Garmin sometimes reports the model already prefixed with the brand. Don't
  // emit "Garmin Garmin Edge 840".
  if (/^garmin\b/i.test(humanized)) return humanized;

  return `${GARMIN_SOURCE_FALLBACK} ${humanized}`;
}

/**
 * Whether a ride carries Garmin device-sourced data and therefore requires
 * attribution.
 *
 * Deliberately keyed on the presence of garminActivityId rather than on a
 * single "primary source" ranking: a ride matched across providers still
 * contains Garmin-sourced data, and the guidelines require attribution
 * wherever that data is present. The inverse matters just as much — the
 * guidelines forbid Garmin branding "in instances where Garmin device-sourced
 * data is not present", so this must stay false for Strava-only and manual rides.
 */
export function hasGarminData(ride: {
  garminActivityId?: string | null;
  // Callers pass full ride objects; the index signature keeps TypeScript's
  // excess-property check from rejecting the other provider ids.
  [key: string]: unknown;
}): boolean {
  return Boolean(ride.garminActivityId);
}
