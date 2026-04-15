import { WeatherCondition } from '@prisma/client';
import { getHourlySamples } from './cache';
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
};

const dominantWmoCode = (codes: number[]): number => {
  // Pick the most "severe" code — highest numeric category tends to indicate
  // precipitation/thunder over clear-sky codes, which is the right signal for rides.
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) || 0) + 1);
  let best = codes[0];
  let bestScore = -Infinity;
  for (const [code, n] of counts) {
    const score = code + n * 0.01; // severity + tiebreaker by frequency
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }
  return best;
};

const mean = (nums: Array<number | null>): number | null => {
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

  const wmo = dominantWmoCode(samples.map((s) => s.wmoCode));
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
  };
};
