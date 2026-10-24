process.env.OVERPASS_MIN_INTERVAL_MS = '1'; // keep multi-fetch tests fast

jest.mock('../prisma', () => ({
  prisma: {
    overpassCache: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('./local-geometry', () => ({
  queryLocalLiftLines: jest.fn(),
}));

import {
  getLiftLines,
  boundsForCells,
  cellKeysForPoints,
  buildOverpassQuery,
  parseOverpassAerialways,
  probeOverpass,
  GeometryUnavailableError,
} from './overpass';
import { prisma } from '../prisma';
import { queryLocalLiftLines } from './local-geometry';

const mockQueryLocal = queryLocalLiftLines as jest.Mock;
const mockFindMany = prisma.overpassCache.findMany as jest.Mock;
const mockUpsert = prisma.overpassCache.upsert as jest.Mock;

const LINE = {
  id: '99',
  name: 'Summit Express',
  kind: 'chair_lift',
  coordinates: [
    { lat: 45.51, lng: -122.02 },
    { lat: 45.52, lng: -122.01 },
  ],
};

// All within the single 0.05° cell whose SW corner is (45.50, -122.05).
const IN_CELL_POINTS = [
  { lat: 45.51, lng: -122.02 },
  { lat: 45.52, lng: -122.01 },
];

const overpassBody = (elements: unknown[]) =>
  ({ ok: true, status: 200, json: async () => ({ elements }) } as Response);

describe('cellKeysForPoints', () => {
  it('maps a compact ride to its single covering cell', () => {
    expect(cellKeysForPoints(IN_CELL_POINTS)).toEqual(['45.50,-122.05']);
  });

  it('covers a bbox spanning cell boundaries with every overlapped cell', () => {
    const keys = cellKeysForPoints([
      { lat: 45.49, lng: -122.02 },
      { lat: 45.51, lng: -122.07 },
    ]);
    expect(keys.sort()).toEqual(
      ['45.45,-122.10', '45.45,-122.05', '45.50,-122.10', '45.50,-122.05'].sort()
    );
  });
});

describe('boundsForCells', () => {
  it('spans the full rectangle of the cells', () => {
    const b = boundsForCells(['45.45,-122.10', '45.45,-122.05', '45.50,-122.10', '45.50,-122.05']);
    expect(b.south).toBeCloseTo(45.45);
    expect(b.west).toBeCloseTo(-122.1);
    expect(b.north).toBeCloseTo(45.55);
    expect(b.east).toBeCloseTo(-122.0);
  });
});

describe('buildOverpassQuery', () => {
  it('queries aerialway ways inside the cell bounds with geometry output', () => {
    const q = buildOverpassQuery('45.50,-122.05');
    expect(q).toContain('way["aerialway"](45.5,-122.05,45.55,-122)');
    expect(q).toContain('out geom;');
  });
});

describe('parseOverpassAerialways', () => {
  it('keeps only multi-point geometries and normalizes fields', () => {
    const lines = parseOverpassAerialways({
      elements: [
        {
          id: 99,
          tags: { aerialway: 'chair_lift', name: 'Summit Express' },
          geometry: [
            { lat: 45.51, lon: -122.02 },
            { lat: 45.52, lon: -122.01 },
          ],
        },
        { id: 100, tags: { aerialway: 'gondola' }, geometry: [{ lat: 45.5, lon: -122.0 }] },
        { id: 101, tags: { aerialway: 'gondola' } },
      ],
    });
    expect(lines).toEqual([LINE]);
  });
});

describe('getLiftLines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    // No local snapshot unless a test loads one: the Overpass path.
    mockQueryLocal.mockResolvedValue(null);
  });

  describe('with a local snapshot loaded', () => {
    it('answers from the snapshot without touching the cache or Overpass', async () => {
      mockQueryLocal.mockResolvedValueOnce([LINE]);

      const result = await getLiftLines(IN_CELL_POINTS);

      expect(result).toEqual({ geometryAvailable: true, liftLines: [LINE] });
      // The same area the Overpass path would search: the covering cell.
      const bbox = mockQueryLocal.mock.calls[0][0];
      expect(bbox.south).toBeCloseTo(45.5);
      expect(bbox.west).toBeCloseTo(-122.05);
      expect(bbox.north).toBeCloseTo(45.55);
      expect(bbox.east).toBeCloseTo(-122.0);
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('treats an empty snapshot answer as a complete "no lifts here"', async () => {
      mockQueryLocal.mockResolvedValueOnce([]);

      const result = await getLiftLines(IN_CELL_POINTS);

      expect(result).toEqual({ geometryAvailable: true, liftLines: [] });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('still refuses an oversized ride, so either source gives the same answer', async () => {
      const result = await getLiftLines([
        { lat: 44.0, lng: -122.0 },
        { lat: 45.0, lng: -121.0 },
      ]);

      expect(result).toEqual({ geometryAvailable: false, liftLines: [], reason: 'too_large' });
      expect(mockQueryLocal).not.toHaveBeenCalled();
    });
  });

  it('serves a fresh cache hit without touching Overpass', async () => {
    mockFindMany.mockResolvedValueOnce([
      { cellKey: '45.50,-122.05', payload: [LINE], isEmpty: false, fetchedAt: new Date() },
    ]);

    const result = await getLiftLines(IN_CELL_POINTS);

    expect(result).toEqual({ geometryAvailable: true, liftLines: [LINE] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('serves a fresh negative-cache hit (isEmpty) without fetching', async () => {
    mockFindMany.mockResolvedValueOnce([
      { cellKey: '45.50,-122.05', payload: [], isEmpty: true, fetchedAt: new Date() },
    ]);

    const result = await getLiftLines(IN_CELL_POINTS);

    expect(result).toEqual({ geometryAvailable: true, liftLines: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches a missing cell, caches the parsed lines, and returns them', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      overpassBody([
        {
          id: 99,
          tags: { aerialway: 'chair_lift', name: 'Summit Express' },
          geometry: [
            { lat: 45.51, lon: -122.02 },
            { lat: 45.52, lon: -122.01 },
          ],
        },
      ])
    );

    const result = await getLiftLines(IN_CELL_POINTS);

    expect(result.geometryAvailable).toBe(true);
    expect(result.liftLines).toEqual([LINE]);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(decodeURIComponent(init.body)).toContain('way["aerialway"]');
    expect(init.headers['User-Agent']).toContain('loam-logger');

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cellKey: '45.50,-122.05' },
        create: expect.objectContaining({ isEmpty: false, payload: [LINE] }),
      })
    );
  });

  it('negative-caches an empty Overpass result', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(overpassBody([]));

    const result = await getLiftLines(IN_CELL_POINTS);

    expect(result).toEqual({ geometryAvailable: true, liftLines: [] });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isEmpty: true, payload: [] }),
      })
    );
  });

  it('refreshes a stale cache entry', async () => {
    const stale = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValueOnce([
      { cellKey: '45.50,-122.05', payload: [], isEmpty: true, fetchedAt: stale },
    ]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(overpassBody([]));

    await getLiftLines(IN_CELL_POINTS);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('degrades without throwing when Overpass fails, and stops after the first failure', async () => {
    // Two cells missing from cache.
    mockFindMany.mockResolvedValueOnce([]);
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await getLiftLines([
      { lat: 45.49, lng: -122.02 },
      { lat: 45.51, lng: -122.02 },
    ]);

    expect(result.geometryAvailable).toBe(false);
    // The transient reason: a caller that must have geometry can retry later.
    expect(result.reason).toBe('fetch_failed');
    expect(result.liftLines).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('falls back to a stale entry for a cell whose refresh failed', async () => {
    const stale = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValueOnce([
      { cellKey: '45.50,-122.05', payload: [LINE], isEmpty: false, fetchedAt: stale },
    ]);
    (global.fetch as jest.Mock).mockRejectedValue(new Error('504'));

    const result = await getLiftLines(IN_CELL_POINTS);

    expect(result.geometryAvailable).toBe(false);
    expect(result.reason).toBe('fetch_failed');
    expect(result.liftLines).toEqual([LINE]);
  });

  it('skips the geometry layer for oversized bounding boxes', async () => {
    const result = await getLiftLines([
      { lat: 44.0, lng: -122.0 },
      { lat: 45.0, lng: -121.0 },
    ]);

    // Not a transient failure: this ride never gets geometry, so a caller
    // that requires it should not wait for a retry.
    expect(result).toEqual({ geometryAvailable: false, liftLines: [], reason: 'too_large' });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('probeOverpass', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('is ok when the status page answers 200, and releases the body', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, body: { cancel } });

    const result = await probeOverpass();

    expect(result).toEqual({ ok: true, detail: 'HTTP 200 from https://overpass-api.de/api/status' });
    expect(cancel).toHaveBeenCalledTimes(1);
    // The status page beside the configured interpreter, with our user agent;
    // no query slot is consumed.
    expect(global.fetch).toHaveBeenCalledWith(
      'https://overpass-api.de/api/status',
      expect.objectContaining({ headers: { 'User-Agent': expect.stringContaining('loam-logger') } })
    );
  });

  it('is not ok on a non-200, naming the status', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 502 });

    const result = await probeOverpass();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('HTTP 502');
  });

  it('is not ok when the status page does not answer within the timeout', async () => {
    // fetch rejects with the AbortError the controller raises on timeout.
    (global.fetch as jest.Mock).mockImplementationOnce((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
        });
      })
    );
    jest.useFakeTimers();
    try {
      const pending = probeOverpass();
      await jest.advanceTimersByTimeAsync(5_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('no answer within 5000ms');
    } finally {
      jest.useRealTimers();
    }
  });

  it('is not ok, and does not throw, when the connection is refused', async () => {
    // What production saw on 2026-10-22: undici's "fetch failed" wrapping ECONNREFUSED.
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    (global.fetch as jest.Mock).mockRejectedValueOnce(err);

    const result = await probeOverpass();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ECONNREFUSED');
  });
});

describe('GeometryUnavailableError', () => {
  it('names the ride and carries the name reportWorkerFailure matches on', () => {
    const err = new GeometryUnavailableError('ride-9');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GeometryUnavailableError');
    expect(err.message).toContain('ride-9');
  });
});
