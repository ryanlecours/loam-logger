export type DataSource = 'garmin' | 'strava' | 'whoop' | 'suunto';

export const DATA_SOURCES: readonly DataSource[] = ['garmin', 'strava', 'whoop', 'suunto'];

export const PROVIDER_LABELS: Record<DataSource, string> = {
  garmin: 'Garmin',
  strava: 'Strava',
  whoop: 'WHOOP',
  suunto: 'Suunto',
};

/**
 * Runtime guard for narrowing untrusted strings (GraphQL responses, URL
 * params, localStorage values) into the four-provider `DataSource` union.
 * The backend's `activeDataSource` field is typed as `AuthProvider`, which
 * also includes `apple` / `google` — a bare cast would let those through
 * silently. Use this guard before treating a value as a fitness provider.
 */
export function isDataSource(value: unknown): value is DataSource {
  return typeof value === 'string' && (DATA_SOURCES as readonly string[]).includes(value);
}
