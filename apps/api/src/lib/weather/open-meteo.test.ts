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

  // Use fake timers throughout so the module-level acquireSlot mutex (which
  // uses setTimeout for its MIN_INTERVAL_MS delay) resolves instantly via
  // timer advancement rather than blocking the test with real 250ms sleeps.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-15T12:00:00Z'));
  });

  afterEach(async () => {
    // Drain any remaining timers left by the test (e.g. the 15s abort
    // setTimeout or the acquireSlot mutex delay) before switching back to
    // real timers. Without this, pending setTimeout callbacks leak into
    // subsequent test files and can cause Jest to hang on CI.
    await jest.runAllTimersAsync();
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const mockFetchOnce = (impl: (...args: unknown[]) => Promise<Response>) => {
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
  };

  const okResponse = (body: unknown): Response =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response);

  // Start fetchHourlyRange and advance fake timers so the module-level
  // acquireSlot mutex (setTimeout-based) and the 15s abort timer both
  // resolve. Returns the still-pending promise for the caller to assert on.
  const callAndDrain = (opts: Parameters<typeof fetchHourlyRange>[0]) => {
    const p = fetchHourlyRange(opts);
    // Drain timers after the promise is in-flight so rejections are captured
    // by the returned promise, not thrown as unhandled rejections.
    const drain = jest.advanceTimersByTimeAsync(16_000);
    // Callers must `await` the returned promise. The drain settles
    // independently; we just need to make sure it doesn't leak.
    drain.catch(() => {});
    return p;
  };

  const archiveOpts = {
    lat: 45.1,
    lng: -122.3,
    startUtc: new Date('2020-01-01T10:00:00Z'),
    endUtc: new Date('2020-01-01T11:00:00Z'),
  };

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

    const rows = await callAndDrain(archiveOpts);

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

    const rows = await callAndDrain({
      ...archiveOpts,
      endUtc: new Date('2020-01-01T12:00:00Z'),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].timeUtc).toBe('2020-01-01T10:00');
    expect(rows[0].feelsLikeC).toBeNull();
    expect(rows[0].humidity).toBeNull();
  });

  it('returns [] when the response has no hourly block', async () => {
    mockFetchOnce(async () => okResponse({}));
    const rows = await callAndDrain(archiveOpts);
    expect(rows).toEqual([]);
  });

  it('throws a descriptive error on a non-200 status', async () => {
    mockFetchOnce(async () =>
      ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
    );
    await expect(callAndDrain(archiveOpts)).rejects.toThrow(
      'Open-Meteo archive request failed: 503'
    );
  });

  it('throws a timeout error when the fetch is aborted', async () => {
    // fetch never resolves — the AbortController will fire after 15s.
    global.fetch = jest.fn((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    await expect(callAndDrain(archiveOpts)).rejects.toThrow(
      'Open-Meteo archive request timed out after 15s'
    );
  });

  it('rethrows non-abort fetch errors unchanged', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(callAndDrain(archiveOpts)).rejects.toThrow('ECONNREFUSED');
  });
});
