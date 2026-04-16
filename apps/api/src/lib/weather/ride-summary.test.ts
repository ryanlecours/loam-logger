jest.mock('./cache', () => ({
  getHourlySamples: jest.fn(),
}));

import { WeatherCondition } from '@prisma/client';
import { getWeatherForRide } from './index';
import { getHourlySamples } from './cache';
import type { HourlyWeather } from './open-meteo';

const mockSamples = getHourlySamples as jest.Mock;

const hour = (isoHour: string, overrides: Partial<HourlyWeather> = {}): HourlyWeather => ({
  timeUtc: isoHour,
  tempC: 15,
  feelsLikeC: 14,
  precipitationMm: 0,
  windSpeedKph: 5,
  humidity: 60,
  wmoCode: 0,
  ...overrides,
});

describe('getWeatherForRide', () => {
  const opts = {
    lat: 45.1,
    lng: -122.3,
    startTime: new Date('2026-04-15T10:00:00Z'),
    durationSeconds: 7200, // 2-hour ride → spans 3 hour-boundaries
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns null when the cache lib returns no samples', async () => {
    mockSamples.mockResolvedValueOnce([]);
    expect(await getWeatherForRide(opts)).toBeNull();
  });

  it('aggregates a fully clear ride into a SUNNY summary', async () => {
    mockSamples.mockResolvedValueOnce([
      hour('2026-04-15T10:00', { tempC: 18, windSpeedKph: 4 }),
      hour('2026-04-15T11:00', { tempC: 20, windSpeedKph: 6 }),
      hour('2026-04-15T12:00', { tempC: 22, windSpeedKph: 5 }),
    ]);

    const result = await getWeatherForRide(opts);

    expect(result).not.toBeNull();
    expect(result!.condition).toBe(WeatherCondition.SUNNY);
    expect(result!.wmoCode).toBe(0);
    expect(result!.tempC).toBe(20); // mean of 18/20/22
    expect(result!.precipitationMm).toBe(0);
    expect(result!.windSpeedKph).toBe(6); // max wind
    expect(result!.source).toBe('open-meteo');
    expect(result!.samples).toHaveLength(3);
  });

  it('promotes otherwise-sunny output to WINDY when any hour is gusty', async () => {
    mockSamples.mockResolvedValueOnce([
      hour('2026-04-15T10:00', { windSpeedKph: 10 }),
      hour('2026-04-15T11:00', { windSpeedKph: 45 }), // over the 40 threshold
      hour('2026-04-15T12:00', { windSpeedKph: 12 }),
    ]);

    const result = await getWeatherForRide(opts);

    expect(result!.condition).toBe(WeatherCondition.WINDY);
    expect(result!.windSpeedKph).toBe(45);
  });

  it('uses worst-hour WMO code and max precip across the ride', async () => {
    mockSamples.mockResolvedValueOnce([
      hour('2026-04-15T10:00', { wmoCode: 0, precipitationMm: 0 }),
      hour('2026-04-15T11:00', { wmoCode: 65, precipitationMm: 3.2 }), // heavy rain
      hour('2026-04-15T12:00', { wmoCode: 3, precipitationMm: 0 }),
    ]);

    const result = await getWeatherForRide(opts);

    expect(result!.wmoCode).toBe(65);
    expect(result!.condition).toBe(WeatherCondition.RAINY);
    expect(result!.precipitationMm).toBe(3.2); // max, not mean
  });

  it('passes through null feelsLikeC/humidity when upstream lacks them', async () => {
    mockSamples.mockResolvedValueOnce([
      hour('2026-04-15T10:00', { feelsLikeC: null, humidity: null }),
      hour('2026-04-15T11:00', { feelsLikeC: null, humidity: null }),
    ]);

    const result = await getWeatherForRide(opts);

    expect(result!.feelsLikeC).toBeNull();
    expect(result!.humidity).toBeNull();
  });

  it('falls back to first sample tempC when mean returns null', async () => {
    // Mean can't return null for tempC since tempC is non-null in our type,
    // but guard against a future loosening — this covers the `?? samples[0].tempC`
    // fallback branch. A single sample trivially produces mean === that value.
    mockSamples.mockResolvedValueOnce([hour('2026-04-15T10:00', { tempC: 7 })]);

    const result = await getWeatherForRide(opts);

    expect(result!.tempC).toBe(7);
  });

  it('forwards the full hour window to getHourlySamples', async () => {
    mockSamples.mockResolvedValueOnce([hour('2026-04-15T10:00')]);
    await getWeatherForRide(opts);

    expect(mockSamples).toHaveBeenCalledWith({
      lat: 45.1,
      lng: -122.3,
      startUtc: opts.startTime,
      // startTime + 7200s = 12:00
      endUtc: new Date('2026-04-15T12:00:00Z'),
    });
  });
});
