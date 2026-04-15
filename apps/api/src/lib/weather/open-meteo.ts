const ARCHIVE_BASE =
  process.env.WEATHER_ARCHIVE_API_BASE || 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_BASE =
  process.env.WEATHER_FORECAST_API_BASE || 'https://api.open-meteo.com/v1/forecast';

// Open-Meteo allows ~10k requests/day free. Serialize with mutex + spacing
// to stay well under burst limits during backfill.
const MIN_INTERVAL_MS = 250;
let lastRequest = 0;
let mutex: Promise<void> = Promise.resolve();

const acquireSlot = async (): Promise<void> => {
  const myTurn = mutex;
  let release!: () => void;
  mutex = new Promise((resolve) => {
    release = resolve;
  });
  await myTurn;
  const elapsed = Date.now() - lastRequest;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequest = Date.now();
  release();
};

export type HourlyWeather = {
  timeUtc: string;        // ISO hour boundary
  tempC: number;
  feelsLikeC: number | null;
  precipitationMm: number;
  windSpeedKph: number;
  humidity: number | null;
  wmoCode: number;
};

type OpenMeteoResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    apparent_temperature?: (number | null)[];
    precipitation?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    weather_code?: (number | null)[];
  };
};

const ARCHIVE_LAG_DAYS = 5;

const formatDate = (d: Date): string => d.toISOString().slice(0, 10);

export const pickEndpoint = (startUtc: Date): 'archive' | 'forecast' => {
  const ageMs = Date.now() - startUtc.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays >= ARCHIVE_LAG_DAYS ? 'archive' : 'forecast';
};

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'wind_speed_10m',
  'relative_humidity_2m',
  'weather_code',
].join(',');

export const fetchHourlyRange = async (opts: {
  lat: number;
  lng: number;
  startUtc: Date;
  endUtc: Date;
}): Promise<HourlyWeather[]> => {
  const endpoint = pickEndpoint(opts.startUtc);
  const base = endpoint === 'archive' ? ARCHIVE_BASE : FORECAST_BASE;
  const url = new URL(base);
  url.searchParams.set('latitude', opts.lat.toString());
  url.searchParams.set('longitude', opts.lng.toString());
  url.searchParams.set('hourly', HOURLY_VARS);
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', 'UTC');

  if (endpoint === 'archive') {
    url.searchParams.set('start_date', formatDate(opts.startUtc));
    url.searchParams.set('end_date', formatDate(opts.endUtc));
  } else {
    // Forecast endpoint: request past days to cover recent rides.
    const ageDays = Math.ceil((Date.now() - opts.startUtc.getTime()) / (1000 * 60 * 60 * 24));
    url.searchParams.set('past_days', Math.min(Math.max(ageDays + 1, 1), 92).toString());
    url.searchParams.set('forecast_days', '1');
  }

  await acquireSlot();
  // Bound every HTTP call so a slow/hung Open-Meteo response can't pin a
  // worker concurrency slot indefinitely. BullMQ retries the job on throw.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error(`Open-Meteo ${endpoint} request timed out after 15s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Open-Meteo ${endpoint} request failed: ${res.status}`);
  }
  const data = (await res.json()) as OpenMeteoResponse;
  const h = data.hourly;
  if (!h || !h.time) return [];

  const out: HourlyWeather[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const timeUtc = h.time[i];
    if (!timeUtc) continue;
    const wmo = h.weather_code?.[i];
    const temp = h.temperature_2m?.[i];
    if (temp == null || wmo == null) continue;
    out.push({
      timeUtc,
      tempC: temp,
      feelsLikeC: h.apparent_temperature?.[i] ?? null,
      precipitationMm: h.precipitation?.[i] ?? 0,
      windSpeedKph: h.wind_speed_10m?.[i] ?? 0,
      humidity: h.relative_humidity_2m?.[i] ?? null,
      wmoCode: wmo,
    });
  }
  return out;
};
