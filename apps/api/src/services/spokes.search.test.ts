/**
 * `searchBikes` end to end, with the network and Redis stubbed.
 *
 * The pure helpers are covered in spokes.test.ts. What is left is the seam
 * between them and the cache, which is where the per-caller filter actually
 * has to hold: the cache stores the UNFILTERED superset so one entry can serve
 * onboarding (which drops framesets) and Add Bike (which does not). A cache
 * hit that skipped the filter would leak framesets into onboarding for 24
 * hours at a time, and no test of a pure function can see that.
 */

const mockGet = jest.fn();
const mockSetex = jest.fn();
const mockIsRedisReady = jest.fn(() => false);

jest.mock('../lib/redis', () => ({
  getRedisConnection: () => ({ get: mockGet, setex: mockSetex }),
  isRedisReady: () => mockIsRedisReady(),
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

process.env.SPOKES_API_KEY = 'test-key';

import { searchBikes } from './spokes';

const COMPLETE = {
  id: 'offering-x0-2026',
  maker: 'Evil',
  model: 'Offering X0',
  year: 2026,
  family: 'Offering',
  category: 'mountain',
  subcategory: null,
  thumbnailUrl: 'https://img/x0.jpg',
};

const FRAMESET = { ...COMPLETE, id: 'offering-frame-2026', model: 'Offering Frame Only' };
const OLDER = { ...COMPLETE, id: 'offering-gx-2023', model: 'Offering / GX I9 Hydra', year: 2023 };

function mockUpstream(items: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ total: items.length, items }),
  }) as unknown as typeof fetch;
}

/** Distinct queries per test: the module also holds an in-process memory cache. */
let queryCounter = 0;
const uniqueQuery = () => `evil offering ${(queryCounter += 1)}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsRedisReady.mockReturnValue(false);
});

describe('searchBikes', () => {
  it('returns the shaped results, newest year first, on a cold call', async () => {
    mockUpstream([OLDER, COMPLETE]);

    const results = await searchBikes({ query: uniqueQuery() });

    expect(results.map((r) => r.id)).toEqual(['offering-x0-2026', 'offering-gx-2023']);
    expect(results[0].thumbnailUrl).toBe('https://img/x0.jpg');
  });

  it('drops framesets for the caller that asks, on a cold call', async () => {
    mockUpstream([COMPLETE, FRAMESET]);

    const results = await searchBikes({ query: uniqueQuery(), excludeFramesets: true });

    expect(results.map((r) => r.id)).toEqual(['offering-x0-2026']);
  });

  it('keeps framesets for the caller that does not ask', async () => {
    mockUpstream([COMPLETE, FRAMESET]);

    const results = await searchBikes({ query: uniqueQuery() });

    expect(results).toHaveLength(2);
  });

  /**
   * The filter runs AFTER the cache read. Onboarding hitting a cache entry
   * that Add Bike populated must still get framesets dropped.
   */
  it('applies the filter to a cache hit, not just a fresh fetch', async () => {
    const query = uniqueQuery();
    mockUpstream([COMPLETE, FRAMESET]);

    const cold = await searchBikes({ query });
    expect(cold).toHaveLength(2);

    // Second call must not reach the network at all.
    (global.fetch as jest.Mock).mockClear();
    const warm = await searchBikes({ query, excludeFramesets: true });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(warm.map((r) => r.id)).toEqual(['offering-x0-2026']);
  });

  it('caches the unfiltered superset, so a later caller can still see framesets', async () => {
    const query = uniqueQuery();
    mockUpstream([COMPLETE, FRAMESET]);

    await searchBikes({ query, excludeFramesets: true });
    (global.fetch as jest.Mock).mockClear();
    const warm = await searchBikes({ query });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(warm).toHaveLength(2);
  });

  it('writes under a v2 key, so v1 entries cannot serve the new shape', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockGet.mockResolvedValue(null);
    mockUpstream([COMPLETE]);

    await searchBikes({ query: 'evil offering v2 key' });

    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('spokes:search:v2:'));
    expect(mockSetex).toHaveBeenCalledWith(
      expect.stringContaining('spokes:search:v2:'),
      expect.any(Number),
      expect.any(String),
    );
  });

  it('does not reach the network for a query under two characters', async () => {
    mockUpstream([COMPLETE]);

    const results = await searchBikes({ query: 'e' });

    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
