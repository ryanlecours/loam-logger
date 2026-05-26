// Cross-platform "Don't blow up the spot" content used by mobile and web
// Trail Stewardship sections. Source of truth for provider-specific
// instructions — keep step lists current as providers change their UIs.

export type StewardshipProviderId = 'strava' | 'garmin' | 'suunto' | 'whoop';

export interface StewardshipProvider {
  /** Stable identifier matching the IntegrationProvider values used elsewhere. */
  provider: StewardshipProviderId;
  /** Display name. */
  name: string;
  /**
   * Whether the provider feeds a publicly viewable heat map or aggregated
   * route dataset. WHOOP does not, so its row is informational only.
   */
  hasPublicHeatmap: boolean;
  /** One-line summary of what is publicly exposed. */
  summary: string;
  /** Step-by-step opt-out instructions, in order. */
  steps: string[];
  /** Deep link to the provider's privacy / settings page. */
  settingsUrl: string;
}

export const STEWARDSHIP_HEADER = {
  title: "Don't blow up the spot.",
  body: "Strava, Garmin, and Suunto can publish your rides on global heat maps, exposing your regular trails, your home patterns, and any unsanctioned lines you ride. Here's how to opt out, per provider. Two minutes per service. Your call.",
};

export const TRAIL_STEWARDSHIP_PROVIDERS: readonly StewardshipProvider[] = [
  {
    provider: 'strava',
    name: 'Strava',
    hasPublicHeatmap: true,
    summary: 'Strava feeds the Global Heatmap and Metro datasets, both publicly viewable.',
    steps: [
      'Open Strava and go to You > Settings > Privacy Controls',
      'Set Activities default to "Followers" or "Only You"',
      'Set Map Visibility to "Hide entire map", or define a Privacy Zone around your home',
      'Under Aggregated Data Usage, uncheck "Include my activities in aggregated data"',
      'Under Metro and Heatmap, opt out of contribution',
    ],
    settingsUrl: 'https://www.strava.com/settings/privacy',
  },
  {
    provider: 'garmin',
    name: 'Garmin',
    hasPublicHeatmap: true,
    summary: 'Garmin Connect aggregates activity data for its public heatmaps and Insights features.',
    steps: [
      'Open Garmin Connect (web) and go to Account Settings > Account Information > Display Preferences',
      'Set the default activity privacy to "Private" or "My Connections"',
      'Go to Account Settings > Privacy and disable "Insights" and any aggregated-data sharing toggles',
      'Optionally remove location data from already-uploaded activities individually',
    ],
    settingsUrl: 'https://www.garmin.com/account/privacy/',
  },
  {
    provider: 'suunto',
    name: 'Suunto',
    hasPublicHeatmap: true,
    summary: 'Suunto publishes a global Heatmap built from app users\' workouts.',
    steps: [
      'Open the Suunto app and go to Profile > Settings > Privacy',
      'Set the default workout visibility to "Private" or "Friends"',
      'Disable "Heatmap" or "Public Heatmap" contribution',
      'Review previously uploaded workouts and adjust visibility individually if needed',
    ],
    settingsUrl: 'https://www.suunto.com/Support/faq-articles/suunto-app/how-do-i-edit-the-privacy-settings-of-my-suunto-app-account/',
  },
  {
    provider: 'whoop',
    name: 'WHOOP',
    hasPublicHeatmap: false,
    summary: "WHOOP doesn't aggregate or publish your routes. No action needed.",
    steps: [],
    settingsUrl: 'https://www.whoop.com/membership/privacy/',
  },
];

/** Lookup by provider id. */
export function getStewardshipProvider(id: StewardshipProviderId): StewardshipProvider | undefined {
  return TRAIL_STEWARDSHIP_PROVIDERS.find((p) => p.provider === id);
}
