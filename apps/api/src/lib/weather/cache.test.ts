jest.mock('../prisma', () => ({
  prisma: {
    weatherCache: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
  },
}));

jest.mock('./open-meteo', () => ({
  fetchHourlyRange: jest.fn(),
}));

import { getHourlySamples } from './cache';
import { prisma } from '../prisma';
import { fetchHourlyRange } from './open-meteo';

const mockFindMany = prisma.weatherCache.findMany as jest.Mock;
const mockCreateMany = prisma.weatherCache.createMany as jest.Mock;
const mockFetch = fetchHourlyRange as jest.Mock;

const sample = (isoHour: string, overrides: Record<string, unknown> = {}) => ({
  timeUtc: isoHour,
  tempC: 15,
  feelsLikeC: 14,
  precipitationMm: 0,
  windSpeedKph: 5,
  humidity: 60,
  wmoCode: 0,
  ...overrides,
});

describe('getHourlySamples', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMany.mockResolvedValue({ count: 0 });
  });

  it('returns the exact set of hours spanned by a 3-hour ride', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce([
      sample('2026-04-15T10:00'),
      sample('2026-04-15T11:00'),
      sample('2026-04-15T12:00'),
    ]);

    const result = await getHourlySamples({
      lat: 45.12,
      lng: -122.34,
      startUtc: new Date('2026-04-15T10:15:00Z'),
      endUtc: new Date('2026-04-15T12:45:00Z'),
    });

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.timeUtc)).toEqual([
      '2026-04-15T10:00',
      '2026-04-15T11:00',
      '2026-04-15T12:00',
    ]);
  });

  it('returns cached rows without hitting Open-Meteo on a full hit', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        hourUtc: new Date('2026-04-15T10:00:00Z'),
        payload: sample('2026-04-15T10:00', { tempC: 20 }),
      },
      {
        hourUtc: new Date('2026-04-15T11:00:00Z'),
        payload: sample('2026-04-15T11:00', { tempC: 22 }),
      },
    ]);

    const result = await getHourlySamples({
      lat: 45.12,
      lng: -122.34,
      startUtc: new Date('2026-04-15T10:15:00Z'),
      endUtc: new Date('2026-04-15T11:45:00Z'),
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
    expect(result.map((s) => s.tempC)).toEqual([20, 22]);
  });

  it('fetches only the missing hours on a partial cache miss and writes them', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        hourUtc: new Date('2026-04-15T10:00:00Z'),
        payload: sample('2026-04-15T10:00', { tempC: 20 }),
      },
    ]);
    // Open-Meteo typically returns the full range requested, not just misses.
    mockFetch.mockResolvedValueOnce([
      sample('2026-04-15T10:00', { tempC: 99 }), // should be ignored (cache wins)
      sample('2026-04-15T11:00', { tempC: 22 }),
      sample('2026-04-15T12:00', { tempC: 24 }),
    ]);

    const result = await getHourlySamples({
      lat: 45.12,
      lng: -122.34,
      startUtc: new Date('2026-04-15T10:15:00Z'),
      endUtc: new Date('2026-04-15T12:45:00Z'),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.map((s) => s.tempC)).toEqual([20, 22, 24]);

    // Only missing hours get persisted, not the cached one.
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const call = mockCreateMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toHaveLength(2);
    const hours = (call.data as { hourUtc: Date }[]).map((d) => d.hourUtc.toISOString());
    expect(hours).toEqual([
      '2026-04-15T11:00:00.000Z',
      '2026-04-15T12:00:00.000Z',
    ]);
  });

  it('rounds lat/lng to 2 decimal places when reading and writing', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce([sample('2026-04-15T10:00')]);

    await getHourlySamples({
      lat: 45.12789,
      lng: -122.34567,
      startUtc: new Date('2026-04-15T10:15:00Z'),
      endUtc: new Date('2026-04-15T10:45:00Z'),
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ latKey: 45.13, lngKey: -122.35 }),
      })
    );
    const writeRow = mockCreateMany.mock.calls[0][0].data[0];
    expect(writeRow.latKey).toBe(45.13);
    expect(writeRow.lngKey).toBe(-122.35);
  });

  it('silently tolerates a cache write failure (best-effort persistence)', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce([sample('2026-04-15T10:00', { tempC: 19 })]);
    mockCreateMany.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getHourlySamples({
      lat: 45.12,
      lng: -122.34,
      startUtc: new Date('2026-04-15T10:15:00Z'),
      endUtc: new Date('2026-04-15T10:45:00Z'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].tempC).toBe(19);
    warn.mockRestore();
  });

  it('omits hours Open-Meteo failed to return from the result', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    // Open-Meteo returns only 2 of 3 requested hours (e.g. range-edge gap).
    mockFetch.mockResolvedValueOnce([
      sample('2026-04-15T10:00'),
      sample('2026-04-15T12:00'),
    ]);

    const result = await getHourlySamples({
      lat: 45.12,
      lng: -122.34,
      startUtc: new Date('2026-04-15T10:15:00Z'),
      endUtc: new Date('2026-04-15T12:45:00Z'),
    });

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.timeUtc)).toEqual([
      '2026-04-15T10:00',
      '2026-04-15T12:00',
    ]);
  });
});
