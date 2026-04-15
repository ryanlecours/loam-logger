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

// "Worst hour wins": a single shower or thunderstorm hour dominates an
// otherwise clear ride. This is the signal wear modeling cares about — any
// exposure to rain/snow affects components — and matches how riders describe
// a ride ("got caught in a storm" beats "mostly sunny").
// WMO code ordering is roughly severity-ordered: 0 clear, 1-3 cloudy, 45/48
// fog, 51-67 drizzle/rain, 71-77 snow, 80-82 showers, 85-86 snow showers,
// 95-99 thunderstorms. Higher = worse within that ordering.
export const worstHourWmoCode = (codes: number[]): number => {
  return codes.reduce((worst, code) => (code > worst ? code : worst), codes[0]);
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
