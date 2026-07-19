process.env.OVERPASS_MIN_INTERVAL_MS = '1'; // keep multi-fetch tests fast

jest.mock('../prisma', () => ({
  prisma: {
    overpassCache: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { getLiftLines, cellKeysForPoints, buildOverpassQuery, parseOverpassAerialways } from './overpass';
import { prisma } from '../prisma';

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
    expect(result.liftLines).toEqual([LINE]);
  });

  it('skips the geometry layer for oversized bounding boxes', async () => {
    const result = await getLiftLines([
      { lat: 44.0, lng: -122.0 },
      { lat: 45.0, lng: -121.0 },
    ]);

    expect(result).toEqual({ geometryAvailable: false, liftLines: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
