import type { StewardshipProviderId } from '@loam/shared';

/**
 * Brand color CSS variable per provider, matching the values used by
 * `DataSourcesSection`. Single source of truth for the stewardship UI on web.
 */
export const STEWARDSHIP_BRAND_COLOR_VARS: Record<StewardshipProviderId, string> = {
  strava: '--brand-strava',
  garmin: '--brand-garmin',
  suunto: '--brand-suunto',
  whoop: '--brand-whoop',
};
