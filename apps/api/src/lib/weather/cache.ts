import { prisma } from '../prisma';
import { fetchHourlyRange, HourlyWeather } from './open-meteo';

const CACHE_PRECISION = 2; // ~1.1km grid

const roundCoord = (c: number): number => parseFloat(c.toFixed(CACHE_PRECISION));
const hourBoundary = (d: Date): Date => {
  const copy = new Date(d);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
};

// Returns hourly samples for the given lat/lng covering [startUtc, endUtc],
// reading from WeatherCache where possible and backfilling misses via Open-Meteo.
//
// Cache entries are kept indefinitely with no TTL, by design:
//
//   1. Archive-endpoint rows (ride hour ≥5 days old at fetch time) represent
//      finalized ERA5 observations and never change, so caching forever is
//      correct and strictly cheaper than re-fetching.
//
//   2. Forecast-endpoint rows (ride hour <5 days old at fetch time) are a
//      theoretical concern — their value could in principle differ slightly
//      from the archive value that same hour will have in 5+ days. In
//      practice this is a non-issue: the weather worker always runs AFTER
//      the ride has ended, so the "forecast" we retrieve is a realized
//      observation of a past hour, not a prediction. The archive would
//      later serve the same observation (plus minor ERA5 reanalysis
//      adjustments that don't affect our condition/precip/wind aggregation
//      at 2dp resolution). Not worth the complexity of a forecast-specific
//      TTL + re-fetch path.
//
// If this assumption changes (e.g., we start fetching weather for in-progress
// rides), revisit: forecast rows would then represent predictions of the
// future and would need a TTL or staleness check.
export const getHourlySamples = async (opts: {
  lat: number;
  lng: number;
  startUtc: Date;
  endUtc: Date;
}): Promise<HourlyWeather[]> => {
  const latKey = roundCoord(opts.lat);
  const lngKey = roundCoord(opts.lng);
  const startHour = hourBoundary(opts.startUtc);
  const endHour = hourBoundary(opts.endUtc);

  const hoursNeeded: Date[] = [];
  for (
    let t = new Date(startHour);
    t.getTime() <= endHour.getTime();
    t = new Date(t.getTime() + 60 * 60 * 1000)
  ) {
    hoursNeeded.push(new Date(t));
  }

  const cached = await prisma.weatherCache.findMany({
    where: {
      latKey,
      lngKey,
      hourUtc: { in: hoursNeeded },
    },
    // Today the unique constraint on (latKey, lngKey, hourUtc) prevents
    // duplicate rows, so this ordering is a no-op. Kept explicit so that if
    // the constraint is ever relaxed (or disabled temporarily during a
    // migration), the Map below deterministically keeps the newest write
    // rather than whatever row the query planner returns first.
    orderBy: { createdAt: 'asc' },
  });
  const cachedByHour = new Map<number, HourlyWeather>();
  for (const row of cached) {
    // Later rows (newer createdAt) win via Map.set overwrite semantics.
    cachedByHour.set(row.hourUtc.getTime(), row.payload as unknown as HourlyWeather);
  }

  const missing = hoursNeeded.filter((h) => !cachedByHour.has(h.getTime()));
  if (missing.length > 0) {
    const fetched = await fetchHourlyRange({
      lat: opts.lat,
      lng: opts.lng,
      startUtc: opts.startUtc,
      endUtc: opts.endUtc,
    });
    const fetchedByHour = new Map<number, HourlyWeather>();
    for (const f of fetched) {
      fetchedByHour.set(new Date(f.timeUtc + 'Z').getTime(), f);
    }
    const rowsToInsert: { latKey: number; lngKey: number; hourUtc: Date; payload: object }[] = [];
    for (const h of missing) {
      const sample = fetchedByHour.get(h.getTime());
      if (!sample) continue;
      cachedByHour.set(h.getTime(), sample);
      rowsToInsert.push({ latKey, lngKey, hourUtc: h, payload: sample as object });
    }
    if (rowsToInsert.length > 0) {
      await prisma.weatherCache
        .createMany({ data: rowsToInsert, skipDuplicates: true })
        .catch((err) => console.warn('[WeatherCache] write failed:', err));
    }
  }

  return hoursNeeded
    .map((h) => cachedByHour.get(h.getTime()))
    .filter((s): s is HourlyWeather => s !== undefined);
};
