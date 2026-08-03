import { fetchStravaDeviceName } from './strava-device';

// The rest of the Strava-attribution feature calls this unconditionally and
// treats null as "no device", so its "swallow everything, never throw" contract
// is what keeps it safe to call in hot paths (backfill loop, latest-sync).
describe('fetchStravaDeviceName', () => {
  const realFetch = global.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('returns device_name from a 200 response', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ device_name: 'Garmin Edge 840' }) });
    await expect(fetchStravaDeviceName('token', 123)).resolves.toBe('Garmin Edge 840');
  });

  it('returns null when the 200 response has no device_name', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(fetchStravaDeviceName('token', 123)).resolves.toBeNull();
  });

  it('returns null on a non-ok response instead of throwing', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'Too Many Requests' });
    await expect(fetchStravaDeviceName('token', 123)).resolves.toBeNull();
  });

  it('returns null when fetch rejects (network error / abort / timeout)', async () => {
    mockFetch.mockRejectedValue(new Error('aborted'));
    await expect(fetchStravaDeviceName('token', 123)).resolves.toBeNull();
  });

  it('passes an abort signal so the request can time out', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ device_name: 'Wahoo ELEMNT' }) });
    await fetchStravaDeviceName('token', 123);
    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
