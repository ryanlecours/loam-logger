import { fetchStravaStreams } from './strava-streams';

const okResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);

const errorResponse = (status: number, text = '') =>
  ({
    ok: false,
    status,
    text: async () => text,
  } as Response);

describe('fetchStravaStreams', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('requests the full stream key set with key_by_type and bearer auth', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(okResponse({}));

    await fetchStravaStreams('token-1', '12345');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/activities/12345/streams');
    expect(url).toContain('keys=time,latlng,altitude,velocity_smooth,cadence,heartrate,moving');
    expect(url).toContain('key_by_type=true');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns no_streams on 404 (manual activity)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(errorResponse(404));

    await expect(fetchStravaStreams('t', '1')).resolves.toEqual({ status: 'no_streams' });
  });

  it('returns no_streams when time or latlng is missing (indoor ride)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({
        time: { data: [0, 1, 2] },
        // no latlng stream
        heartrate: { data: [120, 121, 122] },
      })
    );

    await expect(fetchStravaStreams('t', '1')).resolves.toEqual({ status: 'no_streams' });
  });

  it('throws on transient errors so the queue can retry', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(errorResponse(429, 'Rate Limit Exceeded'));

    await expect(fetchStravaStreams('t', '1')).rejects.toThrow('Strava streams API error: 429');
  });

  it('normalizes streams: velocity_smooth renamed, optional keys only when present', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      okResponse({
        time: { data: [0, 1, 2] },
        latlng: { data: [[45.0, -122.0], [45.001, -122.0], [45.002, -122.0]] },
        altitude: { data: [100, 105, 110] },
        velocity_smooth: { data: [2.5, 2.6, 2.7] },
        moving: { data: [true, true, true] },
        // cadence/heartrate absent (no sensors)
      })
    );

    const result = await fetchStravaStreams('t', '1');

    expect(result).toEqual({
      status: 'ok',
      pointCount: 3,
      data: {
        time: [0, 1, 2],
        latlng: [[45.0, -122.0], [45.001, -122.0], [45.002, -122.0]],
        altitude: [100, 105, 110],
        velocity: [2.5, 2.6, 2.7],
        moving: [true, true, true],
      },
    });
    expect((result as { data: object }).data).not.toHaveProperty('cadence');
    expect((result as { data: object }).data).not.toHaveProperty('heartrate');
  });
});
