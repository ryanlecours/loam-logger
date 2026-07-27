import {
  formatGarminSource,
  GARMIN_CHART_ATTRIBUTION,
  GARMIN_INSIGHT_ATTRIBUTION,
  GARMIN_TRADEMARK_NOTICE,
} from '@loam/shared';

/**
 * Garmin attribution, in the three shapes the Garmin API Brand Guidelines call
 * for. See libs/shared/src/garmin/attribution.ts for the rules and the
 * sanctioned wording.
 *
 * Two things this component deliberately does NOT do:
 *
 *  - It never renders inside a tooltip, footnote or collapsed container. The
 *    guidelines are explicit: "Never bury the Garmin attribution in tooltips,
 *    footnotes or expandable containers." Callers must place it in the visible
 *    layout, adjacent to the data it describes.
 *  - It never decides on its own whether Garmin data is present. Callers gate
 *    on hasGarminData(ride) / a bike's contributing sources, because the
 *    guidelines equally forbid Garmin branding where Garmin data is absent.
 */

type CommonProps = {
  className?: string;
};

/**
 * `badge` — primary displays: ride rows, activity feeds, overview cards.
 * Renders "Garmin Edge 840" beside the entry's title.
 *
 * Garmin blue here is the sanctioned "guest jersey" usage from DESIGN.md: a
 * partner's own badge. It must not leak into surrounding Loam UI.
 *
 * Note the badge opts out of the global `.source-badge` uppercase transform.
 * Upper-casing a device model changes how Garmin's product name is presented,
 * and the guidelines ask for the model "listed in appropriately sized text".
 */
export function GarminSourceBadge({
  deviceName,
  className = '',
}: CommonProps & { deviceName?: string | null }) {
  return (
    <span
      className={`source-badge source-badge-garmin source-badge-garmin-attribution ${className}`.trim()}
    >
      {formatGarminSource(deviceName)}
    </span>
  );
}

/**
 * `inline` — secondary screens: ride detail, expanded views, reports.
 * A quiet line that stays visually associated with the data it supports.
 */
export function GarminSourceLine({
  deviceName,
  className = '',
}: CommonProps & { deviceName?: string | null }) {
  return (
    <p className={`text-xs text-muted ${className}`.trim()}>
      Data source: {formatGarminSource(deviceName)}
    </p>
  );
}

/**
 * `caption` — combined or derived data: anything computed from, blended with,
 * or modelled on Garmin-sourced rides. In Loam Logger that means component wear
 * hours, service predictions, bike health, and the generated maintenance
 * summary.
 *
 * Styled with Loam's muted text token, never Garmin blue — this is Loam's own
 * UI explaining a data lineage, not a Garmin badge.
 */
export function GarminDerivedNote({
  variant = 'insight',
  className = '',
}: CommonProps & { variant?: 'insight' | 'chart' }) {
  return (
    <p className={`text-xs text-muted ${className}`.trim()}>
      {variant === 'chart' ? GARMIN_CHART_ATTRIBUTION : GARMIN_INSIGHT_ATTRIBUTION}
    </p>
  );
}

/**
 * Trademark notice for downstream and publicly-shared surfaces — the shared
 * bike history page, and anything else reachable without authentication.
 */
export function GarminTrademarkNotice({ className = '' }: CommonProps) {
  return (
    <p className={`text-xs text-muted ${className}`.trim()}>{GARMIN_TRADEMARK_NOTICE}</p>
  );
}
