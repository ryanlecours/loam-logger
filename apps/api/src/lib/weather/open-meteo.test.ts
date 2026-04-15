import { pickEndpoint, fetchHourlyRange } from './open-meteo';

describe('pickEndpoint', () => {
  const NOW = new Date('2026-04-15T12:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const daysAgo = (days: number): Date =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  it('uses forecast for a ride starting right now', () => {
    expect(pickEndpoint(NOW)).toBe('forecast');
  });

  it('uses forecast for a ride 1 day old', () => {
    expect(pickEndpoint(daysAgo(1))).toBe('forecast');
  });

  it('uses forecast for a ride just under 5 days old', () => {
    // 4 days 23 hours — still inside the archive lag window.
    expect(pickEndpoint(daysAgo(4.95))).toBe('forecast');
  });

  it('uses archive at exactly 5 days old (inclusive boundary)', () => {
    expect(pickEndpoint(daysAgo(5))).toBe('archive');
  });

  it('uses archive for a ride 10 days old', () => {
    expect(pickEndpoint(daysAgo(10))).toBe('archive');
  });

  it('uses archive for a very old ride', () => {
    expect(pickEndpoint(new Date('2020-01-01T00:00:00Z'))).toBe('archive');
  });
});

describe('fetchHourlyRange', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mockFetchOnce = (impl: () => Promise<Response>) => {
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
  };

  const okResponse = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response);

  it('parses a successful archive response into HourlyWeather rows', async () => {
    mockFetchOnce(async () =>
      okResponse({
        hourly: {
          time: ['2020-01-01T10:00', '2020-01-01T11:00'],
          temperature_2m: [15, 16.5],
          apparent_temperature: [14, 15.5],
          precipitation: [0, 0.2],
          wind_speed_10m: [5, 7],
          relative_humidity_2m: [60, 65],
          weather_code: [0, 3],
        },
      })
    );

    const rows = await fetchHourlyRange({
      lat: 45.1,
      lng: -122.3,
      startUtc: new Date('2020-01-01T10:00:00Z'),
      endUtc: new Date('2020-01-01T11:00:00Z'),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      timeUtc: '2020-01-01T10:00',
      tempC: 15,
      feelsLikeC: 14,
      precipitationMm: 0,
      windSpeedKph: 5,
      humidity: 60,
      wmoCode: 0,
    });
    expect(rows[1].wmoCode).toBe(3);
  });

  it('drops hours with missing temperature or weather_code', async () => {
    mockFetchOnce(async () =>
      okResponse({
        hourly: {
          time: ['2020-01-01T10:00', '2020-01-01T11:00', '2020-01-01T12:00'],
          temperature_2m: [15, null, 18],
          apparent_temperature: [null, null, null],
          precipitation: [0, 0, 0],
          wind_speed_10m: [5, 5, 5],
          relative_humidity_2m: [null, null, null],
          weather_code: [0, 3, null],
        },
      })
    );

    const rows = await fetchHourlyRange({
      lat: 45.1,
      lng: -122.3,
      startUtc: new Date('2020-01-01T10:00:00Z'),
      endUtc: new Date('2020-01-01T12:00:00Z'),
    });

    // Only the 10:00 row has both temp and wmo populated.
    expect(rows).toHaveLength(1);
    expect(rows[0].timeUtc).toBe('2020-01-01T10:00');
    expect(rows[0].feelsLikeC).toBeNull();
    expect(rows[0].humidity).toBeNull();
  });

  it('returns [] when the response has no hourly block', async () => {
    mockFetchOnce(async () => okResponse({}));
    const rows = await fetchHourlyRange({
      lat: 45.1,
      lng: -122.3,
      startUtc: new Date('2020-01-01T10:00:00Z'),
      endUtc: new Date('2020-01-01T11:00:00Z'),
    });
    expect(rows).toEqual([]);
  });

  it('throws a descriptive error on a non-200 status', async () => {
    mockFetchOnce(async () =>
      ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
    );
    await expect(
      fetchHourlyRange({
        lat: 45.1,
        lng: -122.3,
        startUtc: new Date('2020-01-01T10:00:00Z'),
        endUtc: new Date('2020-01-01T11:00:00Z'),
      })
    ).rejects.toThrow('Open-Meteo archive request failed: 503');
  });

  it('throws a timeout error when the fetch is aborted', async () => {
    // Simulate fetch() honoring the AbortController signal.
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    // Advance past the 15s timeout using fake timers.
    jest.useFakeTimers();
    const p = fetchHourlyRange({
      lat: 45.1,
      lng: -122.3,
      startUtc: new Date('2020-01-01T10:00:00Z'),
      endUtc: new Date('2020-01-01T11:00:00Z'),
    });
    jest.advanceTimersByTime(16_000);

    await expect(p).rejects.toThrow('Open-Meteo archive request timed out after 15s');
  });

  it('rethrows non-abort fetch errors unchanged', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      fetchHourlyRange({
        lat: 45.1,
        lng: -122.3,
        startUtc: new Date('2020-01-01T10:00:00Z'),
        endUtc: new Date('2020-01-01T11:00:00Z'),
      })
    ).rejects.toThrow('ECONNREFUSED');
  });
});
