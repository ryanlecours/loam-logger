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
  });
  const cachedByHour = new Map<number, HourlyWeather>();
  for (const row of cached) {
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
    for (const h of missing) {
      const sample = fetchedByHour.get(h.getTime());
      if (!sample) continue;
      cachedByHour.set(h.getTime(), sample);
      await prisma.weatherCache
        .upsert({
          where: { latKey_lngKey_hourUtc: { latKey, lngKey, hourUtc: h } },
          create: { latKey, lngKey, hourUtc: h, payload: sample as object },
          update: { payload: sample as object },
        })
        .catch((err) => console.warn('[WeatherCache] write failed:', err));
    }
  }

  return hoursNeeded
    .map((h) => cachedByHour.get(h.getTime()))
    .filter((s): s is HourlyWeather => s !== undefined);
};
