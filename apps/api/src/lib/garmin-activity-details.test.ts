jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { fetchGarminActivityDetails, flattenGarminActivity } from './garmin-activity-details';

const API_BASE = 'https://garmin.test/wellness-api';
const TOKEN = 'token-abc';
const SUMMARY_ID = '9876543210';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const detailsFor = (summaryId: string, samples: unknown = [{ latitudeInDegree: 48.7 }]) => ({
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

describe('fetchGarminActivityDetails', () => {
  describe('URL selection', () => {
    // Garmin's ping already scoped the callbackURL to exactly the activities it
    // is notifying about, so it needs no window arithmetic and cannot drift.
    it('prefers the ping callbackURL when one was supplied', async () => {
      mockFetch.mockResolvedValue(ok([detailsFor(SUMMARY_ID)]));

      await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        callbackURL: 'https://garmin.test/callback/xyz',
        uploadTimestampInSeconds: 1_700_000_000,
        apiBase: API_BASE,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://garmin.test/callback/xyz',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
        })
      );
    });

    it('falls back to an upload window on the activityDetails endpoint', async () => {
      mockFetch.mockResolvedValue(ok([detailsFor(SUMMARY_ID)]));

      await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        uploadTimestampInSeconds: 1_700_000_000,
        apiBase: API_BASE,
      });

      const [url] = mockFetch.mock.calls[0];
      // Details, never /rest/activities. The summary endpoint is what carried
      // no samples and left every Garmin ride without a map.
      expect(url).toContain('/rest/activityDetails');
      expect(url).toContain('uploadStartTimeInSeconds=1699999940');
      expect(url).toContain('uploadEndTimeInSeconds=1700000060');
    });

    // Fabricating a window with nothing to anchor it to is the unprompted pull
    // the Connect Developer Program forbids.
    it('declines to fetch when neither a callbackURL nor a timestamp is known', async () => {
      const result = await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        apiBase: API_BASE,
      });

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('matching', () => {
    it('returns the entry whose summaryId matches', async () => {
      mockFetch.mockResolvedValue(
        ok([detailsFor('1111111111'), detailsFor(SUMMARY_ID, [{ latitudeInDegree: 48.75 }])])
      );

      const result = await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        callbackURL: 'https://garmin.test/callback/xyz',
      });

      expect(result?.summaryId).toBe(SUMMARY_ID);
      expect(result?.samples).toEqual([{ latitudeInDegree: 48.75 }]);
    });

    // Garmin suffixes the details id for some activity kinds.
    it('matches a details id that carries a suffix', async () => {
      mockFetch.mockResolvedValue(ok([detailsFor(`${SUMMARY_ID}-detail`)]));

      const result = await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        callbackURL: 'https://garmin.test/callback/xyz',
      });

      expect(result?.summaryId).toBe(`${SUMMARY_ID}-detail`);
    });

    it('tolerates a bare object instead of an array', async () => {
      mockFetch.mockResolvedValue(ok(detailsFor(SUMMARY_ID)));

      const result = await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        callbackURL: 'https://garmin.test/callback/xyz',
      });

      expect(result?.summaryId).toBe(SUMMARY_ID);
    });

    // A window pull can legitimately return several activities. Attaching
    // another ride's GPS to this one is far worse than showing no map.
    it('returns null rather than guessing when nothing matches', async () => {
      mockFetch.mockResolvedValue(ok([detailsFor('2222222222'), detailsFor('3333333333')]));

      const result = await fetchGarminActivityDetails({
        accessToken: TOKEN,
        summaryId: SUMMARY_ID,
        uploadTimestampInSeconds: 1_700_000_000,
      });

      expect(result).toBeNull();
    });
  });

  describe('failure handling', () => {
    // By the time this runs the ride and its component hours are committed.
    // Losing a track costs a map; throwing would cost the ride.
    it('returns null on a non-ok response instead of throwing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
        json: async () => ({}),
      });

      await expect(
        fetchGarminActivityDetails({
          accessToken: TOKEN,
          summaryId: SUMMARY_ID,
          callbackURL: 'https://garmin.test/callback/xyz',
        })
      ).resolves.toBeNull();
    });

    it('returns null when the request throws', async () => {
      mockFetch.mockRejectedValue(new Error('socket hang up'));

      await expect(
        fetchGarminActivityDetails({
          accessToken: TOKEN,
          summaryId: SUMMARY_ID,
          callbackURL: 'https://garmin.test/callback/xyz',
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
        fetchGarminActivityDetails({
          accessToken: TOKEN,
          summaryId: SUMMARY_ID,
          callbackURL: 'https://garmin.test/callback/xyz',
        })
      ).resolves.toBeNull();
    });
  });
});
