import { RIDE_PROVIDERS, providerRideWhere } from './ride-predicates';

/**
 * A stand-in Ride carrying only the four provider-id columns, which is all
 * the bucket rule reads.
 */
type ProviderColumns = {
  stravaActivityId: string | null;
  garminActivityId: string | null;
  whoopWorkoutId: string | null;
  suuntoWorkoutId: string | null;
};

const NO_PROVIDERS: ProviderColumns = {
  stravaActivityId: null,
  garminActivityId: null,
  whoopWorkoutId: null,
  suuntoWorkoutId: null,
};

/**
 * Evaluate a `providerRideWhere` clause in JS, the way Postgres would.
 * The clause only ever contains `column: null` and `column: { not: null }`
 * terms, so this is a faithful stand-in and lets the partition property be
 * tested without a database.
 */
function matches(where: Record<string, unknown>, ride: ProviderColumns): boolean {
  return Object.entries(where).every(([column, condition]) => {
    const value = ride[column as keyof ProviderColumns];
    if (condition === null) return value === null;
    if (condition && typeof condition === 'object' && 'not' in condition) {
      return value !== null;
    }
    throw new Error(`Unexpected condition on ${column}: ${JSON.stringify(condition)}`);
  });
}

describe('providerRideWhere', () => {
  it('claims a ride for the provider that actually recorded it', () => {
    const garminRide = { ...NO_PROVIDERS, garminActivityId: 'g-1' };

    expect(matches(providerRideWhere('GARMIN'), garminRide)).toBe(true);
    expect(matches(providerRideWhere('STRAVA'), garminRide)).toBe(false);
    expect(matches(providerRideWhere('MANUAL'), garminRide)).toBe(false);
  });

  it('files a cross-provider ride under the higher-priority provider only', () => {
    // Recorded on a Garmin, imported through Strava. Both badges show on the
    // ride row (Garmin's guidelines require attribution wherever their data
    // appears), but exactly one filter bucket may claim it.
    const crossProvider = {
      ...NO_PROVIDERS,
      stravaActivityId: 's-1',
      garminActivityId: 'g-1',
    };

    expect(matches(providerRideWhere('STRAVA'), crossProvider)).toBe(true);
    expect(matches(providerRideWhere('GARMIN'), crossProvider)).toBe(false);
  });

  it('treats a ride with no provider id as manual', () => {
    expect(matches(providerRideWhere('MANUAL'), NO_PROVIDERS)).toBe(true);
    for (const provider of RIDE_PROVIDERS.filter((p) => p !== 'MANUAL')) {
      expect(matches(providerRideWhere(provider), NO_PROVIDERS)).toBe(false);
    }
  });

  it('partitions every combination of provider ids into exactly one bucket', () => {
    // The property the whole design rests on. If two buckets ever claimed the
    // same ride, per-provider counts would sum past the total and a rider
    // clearing their backlog provider by provider would be offered the same
    // ride twice.
    const columns: (keyof ProviderColumns)[] = [
      'stravaActivityId',
      'garminActivityId',
      'whoopWorkoutId',
      'suuntoWorkoutId',
    ];

    for (let mask = 0; mask < 1 << columns.length; mask++) {
      const ride = { ...NO_PROVIDERS };
      columns.forEach((column, index) => {
        if (mask & (1 << index)) ride[column] = `id-${index}`;
      });

      const claiming = RIDE_PROVIDERS.filter((provider) =>
        matches(providerRideWhere(provider), ride)
      );

      expect(claiming).toHaveLength(1);
    }
  });
});
