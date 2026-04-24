export type DataSource = 'garmin' | 'strava' | 'whoop' | 'suunto';

export const DATA_SOURCES: readonly DataSource[] = ['garmin', 'strava', 'whoop', 'suunto'];

export const PROVIDER_LABELS: Record<DataSource, string> = {
  garmin: 'Garmin',
  strava: 'Strava',
  whoop: 'WHOOP',
  suunto: 'Suunto',
};
