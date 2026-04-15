import { WeatherCondition } from '@prisma/client';

// Map Open-Meteo WMO weather interpretation codes to our normalized enum.
// Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
export const wmoToCondition = (code: number): WeatherCondition => {
  if (!Number.isFinite(code)) return WeatherCondition.UNKNOWN;
  if (code === 0) return WeatherCondition.SUNNY;                  // Clear sky
  if (code >= 1 && code <= 3) return WeatherCondition.CLOUDY;     // Mainly clear, partly cloudy, overcast
  if (code === 45 || code === 48) return WeatherCondition.FOGGY;  // Fog
  if (code >= 51 && code <= 57) return WeatherCondition.RAINY;    // Drizzle
  if (code >= 61 && code <= 67) return WeatherCondition.RAINY;    // Rain
  if (code >= 71 && code <= 77) return WeatherCondition.SNOWY;    // Snow
  if (code >= 80 && code <= 82) return WeatherCondition.RAINY;    // Rain showers
  if (code >= 85 && code <= 86) return WeatherCondition.SNOWY;    // Snow showers
  if (code >= 95 && code <= 99) return WeatherCondition.RAINY;    // Thunderstorm
  return WeatherCondition.UNKNOWN;
};

// Elevate windy if sustained wind is high, regardless of base condition.
// Threshold: ~40 kph (moderate/strong breeze).
export const applyWindyOverride = (
  condition: WeatherCondition,
  windSpeedKph: number
): WeatherCondition => {
  if (condition === WeatherCondition.SUNNY || condition === WeatherCondition.CLOUDY) {
    if (Number.isFinite(windSpeedKph) && windSpeedKph >= 40) {
      return WeatherCondition.WINDY;
    }
  }
  return condition;
};
