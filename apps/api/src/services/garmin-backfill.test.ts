// Mock fetch + logger before importing the module under test.
const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { triggerGarminBackfillChunks, extractMinStartDate } from './garmin-backfill';

const ok202 = { status: 202, ok: true };

describe('extractMinStartDate', () => {
  it('parses Garmin\'s min-start error message', () => {
    const dt = extractMinStartDate(
      JSON.stringify({
        errorMessage:
          'summaryStartTimeInSeconds must be greater than or equal to min start time of 2023-01-15T00:00:00Z',
      })
    );
    expect(dt?.toISOString()).toBe('2023-01-15T00:00:00.000Z');
  });

  it('returns null for unrelated or unparseable text', () => {
    expect(extractMinStartDate('not json')).toBeNull();
    expect(extractMinStartDate(JSON.stringify({ errorMessage: 'something else' }))).toBeNull();
  });
});

describe('triggerGarminBackfillChunks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(ok202);
  });

  it('chunks the range into 30-day windows and counts accepted chunks', async () => {
    // 45 days → two chunks (30 + 15).
    const startDate = new Date('2026-05-01T00:00:00Z');
    const endDate = new Date('2026-06-15T00:00:00Z');

    const result = await triggerGarminBackfillChunks({
      accessToken: 'tok',
      startDate,
      endDate,
      apiBase: 'https://garmin.test/wellness-api',
    });

    expect(result.totalChunks).toBe(2);
    expect(result.allDuplicates).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // First chunk starts at startDate and requests via the backfill endpoint.
    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toContain('https://garmin.test/wellness-api/rest/backfill/activities');
    expect(firstUrl).toContain(`summaryStartTimeInSeconds=${Math.floor(startDate.getTime() / 1000)}`);
    // Auth header is passed through.
    expect(mockFetch.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    });
  });

  it('flags allDuplicates when every chunk returns 409', async () => {
    mockFetch.mockResolvedValue({ status: 409, ok: false });

    const result = await triggerGarminBackfillChunks({
      accessToken: 'tok',
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-20T00:00:00Z'),
    });

    expect(result.totalChunks).toBe(0);
    expect(result.allDuplicates).toBe(true);
    expect(result.errors).toHaveLength(1);
  });

  it('adjusts the start date and retries when Garmin reports a min start time', async () => {
    const startDate = new Date('2020-01-01T00:00:00Z'); // too old
    const endDate = new Date('2020-02-15T00:00:00Z');
    mockFetch
      .mockResolvedValueOnce({
        status: 400,
        ok: false,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              errorMessage:
                'summaryStartTimeInSeconds must be greater than or equal to min start time of 2020-02-01T00:00:00Z',
            })
          ),
      })
      .mockResolvedValue(ok202);

    const result = await triggerGarminBackfillChunks({ accessToken: 'tok', startDate, endDate });

    // Retried from the adjusted min start rather than failing the whole range.
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    expect(result.totalChunks).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes('Adjusted start date'))).toBe(true);
  });

  it('still fires every chunk when a per-chunk throttle delay is set', async () => {
    // 45 days → 2 chunks; a real (short) delay is inserted between them.
    const start = Date.now();
    const result = await triggerGarminBackfillChunks({
      accessToken: 'tok',
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-06-15T00:00:00Z'),
      delayBetweenChunksMs: 20,
    });

    expect(result.totalChunks).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // One inter-chunk delay of ~20ms should have elapsed (allow scheduler slack).
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('collects an error note for non-2xx chunk failures without throwing', async () => {
    mockFetch.mockResolvedValue({ status: 500, ok: false, text: () => Promise.resolve('boom') });

    const result = await triggerGarminBackfillChunks({
      accessToken: 'tok',
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
    });

    expect(result.totalChunks).toBe(0);
    expect(result.errors[0]).toContain('500');
    expect(result.allDuplicates).toBe(false);
  });
});
