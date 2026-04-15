import { WeatherCondition } from '@prisma/client';
import { getHourlySamples } from './cache';
import type { HourlyWeather } from './open-meteo';
import { applyWindyOverride, wmoToCondition } from './normalize';

export type RideWeatherSummary = {
  tempC: number;
  feelsLikeC: number | null;
  precipitationMm: number;
  windSpeedKph: number;
  humidity: number | null;
  wmoCode: number;
  condition: WeatherCondition;
  source: string;
  samples: HourlyWeather[];
};

// Explicit severity rank for WMO codes. Raw numeric ordering is monotonic
// *within* sub-categories (e.g. 61<63<65 is light→heavy rain) but not across
// them — code 80 (slight showers) is numerically higher than 67 (heavy
// freezing rain) despite being meaningfully milder. We rank by category
// first (dry → fog → drizzle → rain → showers → snow → freezing → storms)
// and by intensity within each category.
//
// The numbers themselves are opaque; only their ordering matters.
const WMO_SEVERITY: Record<number, number> = {
  0: 0,   // Clear sky
  1: 10,  // Mainly clear
  2: 11,  // Partly cloudy
  3: 12,  // Overcast
  45: 20, // Fog
  48: 21, // Depositing rime fog
  51: 30, // Light drizzle
  53: 31, // Moderate drizzle
  55: 32, // Dense drizzle
  56: 45, // Light freezing drizzle
  57: 46, // Dense freezing drizzle
  61: 40, // Slight rain
  63: 41, // Moderate rain
  65: 42, // Heavy rain
  80: 50, // Slight rain showers
  81: 51, // Moderate rain showers
  82: 52, // Violent rain showers
  66: 60, // Light freezing rain
  67: 61, // Heavy freezing rain
  71: 70, // Slight snow fall
  73: 71, // Moderate snow fall
  75: 72, // Heavy snow fall
  77: 73, // Snow grains
  85: 80, // Slight snow showers
  86: 81, // Heavy snow showers
  95: 90, // Thunderstorm
  96: 91, // Thunderstorm with slight hail
  99: 92, // Thunderstorm with heavy hail
};

const severity = (code: number): number => WMO_SEVERITY[code] ?? -1;

// "Worst hour wins": a single shower or thunderstorm hour dominates an
// otherwise clear ride. This is the signal wear modeling cares about — any
// exposure to rain/snow affects components — and matches how riders describe
// a ride ("got caught in a storm" beats "mostly sunny"). Ties fall back to
// numeric code to keep output deterministic.
export const worstHourWmoCode = (codes: number[]): number => {
  return codes.reduce((worst, code) => {
    if (severity(code) > severity(worst)) return code;
    return worst;
  }, codes[0]);
};

export const mean = (nums: Array<number | null>): number | null => {
  const valid = nums.filter((n): n is number => n != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
};

export const getWeatherForRide = async (opts: {
  lat: number;
  lng: number;
  startTime: Date;
  durationSeconds: number;
}): Promise<RideWeatherSummary | null> => {
  const endTime = new Date(opts.startTime.getTime() + opts.durationSeconds * 1000);
  const samples = await getHourlySamples({
    lat: opts.lat,
    lng: opts.lng,
    startUtc: opts.startTime,
    endUtc: endTime,
  });
  if (samples.length === 0) return null;

  const wmo = worstHourWmoCode(samples.map((s) => s.wmoCode));
  const maxPrecip = Math.max(...samples.map((s) => s.precipitationMm));
  const maxWind = Math.max(...samples.map((s) => s.windSpeedKph));
  const avgTemp = mean(samples.map((s) => s.tempC)) ?? samples[0].tempC;
  const avgFeels = mean(samples.map((s) => s.feelsLikeC));
  const avgHumidity = mean(samples.map((s) => s.humidity));

  const baseCondition = wmoToCondition(wmo);
  const condition = applyWindyOverride(baseCondition, maxWind);

  return {
    tempC: avgTemp,
    feelsLikeC: avgFeels,
    precipitationMm: maxPrecip,
    windSpeedKph: maxWind,
    humidity: avgHumidity,
    wmoCode: wmo,
    condition,
    source: 'open-meteo',
    samples,
  };
};
