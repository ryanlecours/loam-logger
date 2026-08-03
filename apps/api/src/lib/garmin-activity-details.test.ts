jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { fetchGarminActivityFromCallback, flattenGarminActivity } from './garmin-activity-details';

const TOKEN = 'token-abc';
const SUMMARY_ID = '9876543210';
const CALLBACK_URL =
  'https://apis.garmin.com/wellness-api/rest/activityDetails?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const entry = (summaryId: string, samples: unknown = [{ latitudeInDegree: 48.7 }]) => ({
  summaryId,
  activityType: 'MOUNTAIN_BIKING',
  samples,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('flattenGarminActivity', () => {
  // The two Garmin summary types are not the same shape. Ingest code reads the
  // flat one, so a details payload arriving unflattened has an undefined
  // activityType and throws on the first .toLowerCase().
  it('lifts a nested summary onto the top level', () => {
    const flat = flattenGarminActivity({
      summaryId: SUMMARY_ID,
      samples: [{ latitudeInDegree: 48.75 }],
      summary: {
        activityType: 'MOUNTAIN_BIKING',
        startTimeInSeconds: 1706123456,
        distanceInMeters: 8368,
      },
    });

    expect(flat.activityType).toBe('MOUNTAIN_BIKING');
    expect(flat.distanceInMeters).toBe(8368);
    // The samples must survive the lift; they are the whole point.
    expect(flat.samples).toEqual([{ latitudeInDegree: 48.75 }]);
  });

  // summaryId and userId are top-level identity and must not be shadowed by a
  // same-named key inside the nested summary.
  it('lets outer keys win over nested ones', () => {
    const flat = flattenGarminActivity({
      summaryId: 'outer',
      summary: { summaryId: 'inner', activityType: 'ROAD_BIKING' },
    });

    expect(flat.summaryId).toBe('outer');
    expect(flat.activityType).toBe('ROAD_BIKING');
  });

  it('passes an already-flat activities payload through untouched', () => {
    const activity = { summaryId: SUMMARY_ID, activityType: 'MOUNTAIN_BIKING' };
    expect(flattenGarminActivity(activity)).toEqual(activity);
  });

  it('ignores a summary that is not an object', () => {
    const activity = { summaryId: SUMMARY_ID, summary: 'nonsense' };
    expect(flattenGarminActivity(activity)).toEqual(activity);
  });
});

describe('fetchGarminActivityFromCallback', () => {
  // The entire point: Garmin's Partner Verification counts a pull as prompted
  // only when it matches a URL Garmin issued. Composing our own request is an
  // unprompted pull AND leaves the ping unanswered, failing two checks at once.
  it('requests exactly the URL Garmin supplied, unmodified', async () => {
    mockFetch.mockResolvedValue(ok([entry(SUMMARY_ID)]));

    await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      CALLBACK_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    );
  });

  // Defence in depth. The webhook already screens the URL, but this function
  // attaches a live Garmin bearer token, so it must refuse on its own rather
  // than trusting that every future caller screened its input.
  it('refuses to send the token to a non-Garmin origin', async () => {
    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: 'https://attacker.example/steal',
    });

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // An allowed origin must not be able to bounce the request, and its token,
  // somewhere else.
  it('refuses to follow redirects', async () => {
    mockFetch.mockResolvedValue(ok([entry(SUMMARY_ID)]));

    await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      CALLBACK_URL,
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('returns the entry whose summaryId matches', async () => {
    mockFetch.mockResolvedValue(
      ok([entry('1111111111'), entry(SUMMARY_ID, [{ latitudeInDegree: 48.75 }])])
    );

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(result?.summaryId).toBe(SUMMARY_ID);
    expect(result?.samples).toEqual([{ latitudeInDegree: 48.75 }]);
  });

  // One prompted request has to yield both the stats and the track, otherwise
  // we are back to needing a second call that verification would flag.
  it('flattens a nested details payload so stats and samples arrive together', async () => {
    mockFetch.mockResolvedValue(
      ok([
        {
          summaryId: SUMMARY_ID,
          samples: [{ latitudeInDegree: 48.75 }],
          summary: { activityType: 'MOUNTAIN_BIKING', durationInSeconds: 5340 },
        },
      ])
    );

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(result?.activityType).toBe('MOUNTAIN_BIKING');
    expect(result?.durationInSeconds).toBe(5340);
    expect(result?.samples).toEqual([{ latitudeInDegree: 48.75 }]);
  });

  // Garmin suffixes the details id for some activity kinds.
  it('matches a details id that carries a suffix', async () => {
    mockFetch.mockResolvedValue(ok([entry(`${SUMMARY_ID}-detail`)]));

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(result?.summaryId).toBe(`${SUMMARY_ID}-detail`);
  });

  // The dangerous inverse of the suffix case. A callbackURL covers an upload
  // window and can carry several activities; the old leading-segment rule made
  // any two ids sharing a prefix segment "the same activity", which is how one
  // ride's samples end up on another ride.
  it('does not match a different activity that shares a leading segment', async () => {
    mockFetch.mockResolvedValue(ok([entry('activity-999')]));

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: 'activity-123',
      callbackURL: CALLBACK_URL,
    });

    expect(result).toBeNull();
  });

  it('picks the right entry when a payload carries prefix-sharing ids', async () => {
    mockFetch.mockResolvedValue(ok([entry('activity-999'), entry('activity-123')]));

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: 'activity-123',
      callbackURL: CALLBACK_URL,
    });

    expect(result?.summaryId).toBe('activity-123');
  });

  // Only `-detail` is documented, but the rule holds for any suffix appended to
  // the id we asked for, because the whole requested id must precede it.
  it('matches an unfamiliar suffix on the requested id', async () => {
    mockFetch.mockResolvedValue(ok([entry(`${SUMMARY_ID}-summary`)]));

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(result?.summaryId).toBe(`${SUMMARY_ID}-summary`);
  });

  it('tolerates a bare object instead of an array', async () => {
    mockFetch.mockResolvedValue(ok(entry(SUMMARY_ID)));

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(result?.summaryId).toBe(SUMMARY_ID);
  });

  // A callbackURL covers an upload window and can carry several activities.
  // Attaching another ride's data to this one is worse than importing nothing.
  it('returns null rather than guessing when nothing matches', async () => {
    mockFetch.mockResolvedValue(ok([entry('2222222222'), entry('3333333333')]));

    const result = await fetchGarminActivityFromCallback({
      accessToken: TOKEN,
      summaryId: SUMMARY_ID,
      callbackURL: CALLBACK_URL,
    });

    expect(result).toBeNull();
  });

  describe('failure handling', () => {
    it('returns null on a non-ok response instead of throwing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
        json: async () => ({}),
      });

      await expect(
        fetchGarminActivityFromCallback({
          accessToken: TOKEN,
          summaryId: SUMMARY_ID,
          callbackURL: CALLBACK_URL,
        })
      ).resolves.toBeNull();
    });

    it('returns null when the request throws', async () => {
      mockFetch.mockRejectedValue(new Error('socket hang up'));

      await expect(
        fetchGarminActivityFromCallback({
          accessToken: TOKEN,
          summaryId: SUMMARY_ID,
          callbackURL: CALLBACK_URL,
        })
      ).resolves.toBeNull();
    });

    it('returns null when the body is not JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token');
        },
        text: async () => 'not json',
      });

      await expect(
        fetchGarminActivityFromCallback({
          accessToken: TOKEN,
          summaryId: SUMMARY_ID,
          callbackURL: CALLBACK_URL,
        })
      ).resolves.toBeNull();
    });
  });
});
