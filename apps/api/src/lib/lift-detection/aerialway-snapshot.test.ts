jest.mock('../prisma', () => ({ prisma: {} }));

import {
  buildTileQuery,
  datasetFromOsmiumExport,
  fetchAerialwaySnapshot,
  parseGeojsonSeqAerialways,
  worldTiles,
} from './aerialway-snapshot';
import { validateAerialwayDataset } from './local-geometry';

const way = (id: number, aerialway = 'chair_lift') => ({
  id,
  tags: { aerialway, name: `Lift ${id}` },
  geometry: [
    { lat: 45.51, lon: -122.02 },
    { lat: 45.52, lon: -122.01 },
  ],
});

const answer = (elements: unknown[], osmBase = '2026-10-24T08:00:00Z', remark?: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ osm3s: { timestamp_osm_base: osmBase }, elements, ...(remark ? { remark } : {}) }),
  }) as unknown as Response;

const failure = (status: number) =>
  ({ ok: false, status, body: { cancel: jest.fn() }, text: async () => 'bad query' }) as unknown as Response;

const noSleep = jest.fn(async () => undefined);

describe('worldTiles', () => {
  it('covers the globe exactly once at the default size', () => {
    const tiles = worldTiles(20);
    expect(tiles).toHaveLength(9 * 18);
    expect(tiles[0]).toEqual({ south: -90, west: -180, north: -70, east: -160 });
    expect(tiles[tiles.length - 1]).toEqual({ south: 70, west: 160, north: 90, east: 180 });
    const area = tiles.reduce((sum, t) => sum + (t.north - t.south) * (t.east - t.west), 0);
    expect(area).toBe(180 * 360);
  });

  it('refuses a size that leaves a gap at the edge', () => {
    expect(() => worldTiles(25)).toThrow('divide 180');
    expect(() => worldTiles(0)).toThrow('divide 180');
  });
});

describe('buildTileQuery', () => {
  it('uses the same aerialway filter as the per-cell query, with full geometry', () => {
    const q = buildTileQuery({ south: 40, west: 0, north: 60, east: 20 });
    expect(q).toContain('way["aerialway"](40,0,60,20)');
    expect(q).toContain('out geom;');
  });
});

describe('fetchAerialwaySnapshot', () => {
  beforeEach(() => {
    noSleep.mockClear();
  });

  it('merges every tile, dedupes lifts that cross a tile edge, and keeps the oldest OSM base', async () => {
    // 90° tiles: 2 x 4 = 8 queries.
    const fetchImpl = jest.fn(async () => answer([]));
    fetchImpl
      .mockResolvedValueOnce(answer([way(2), way(1)], '2026-10-24T08:00:00Z'))
      .mockResolvedValueOnce(answer([way(1), way(3, 'gondola')], '2026-10-24T07:00:00Z'));

    const dataset = await fetchAerialwaySnapshot({
      endpoint: 'https://overpass.example/api/interpreter',
      tileDeg: 90,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(dataset.lines.map((l) => l.id)).toEqual(['1', '2', '3']);
    expect(dataset.osmBaseAt).toBe('2026-10-24T07:00:00Z');
    expect(dataset.source).toBe('overpass:https://overpass.example/api/interpreter');
    expect(dataset.license).toBe('ODbL-1.0');
    // A pause between tiles, none before the first.
    expect(noSleep).toHaveBeenCalledTimes(7);
    // What fetch writes, load accepts.
    expect(() => validateAerialwayDataset(dataset)).not.toThrow();
  });

  it('retries a busy tile after waiting, then carries on', async () => {
    const fetchImpl = jest.fn(async () => answer([]));
    fetchImpl
      .mockResolvedValueOnce(failure(429))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(answer([way(1)]));

    const dataset = await fetchAerialwaySnapshot({
      tileDeg: 90,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(dataset.lines).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    // Overpass asks for at least 30s after a 429.
    expect(noSleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(noSleep).toHaveBeenNthCalledWith(2, 60_000);
  });

  it('aborts the whole snapshot when a tile keeps failing, rather than leave a hole', async () => {
    const fetchImpl = jest.fn(async () => failure(504));

    await expect(
      fetchAerialwaySnapshot({ tileDeg: 90, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })
    ).rejects.toThrow('Snapshot aborted at tile 1/8');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('does not retry a query Overpass rejects as malformed', async () => {
    const fetchImpl = jest.fn(async () => failure(400));

    await expect(
      fetchAerialwaySnapshot({ tileDeg: 90, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep })
    ).rejects.toThrow('HTTP 400');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats a server-side timeout remark as a failed tile, not a partial answer', async () => {
    const fetchImpl = jest.fn(async () => answer([]));
    fetchImpl.mockResolvedValueOnce(
      answer([way(1)], undefined, 'runtime error: Query timed out in "query" at line 2 after 181 seconds.')
    );
    fetchImpl.mockResolvedValueOnce(answer([way(1), way(2)]));

    const dataset = await fetchAerialwaySnapshot({
      tileDeg: 90,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(dataset.lines).toHaveLength(2);
    expect(noSleep).toHaveBeenNthCalledWith(1, 30_000);
  });
});

describe('parseGeojsonSeqAerialways (osmium fallback)', () => {
  const RS = String.fromCharCode(0x1e);
  const feature = (f: object) => `${RS}${JSON.stringify({ type: 'Feature', ...f })}`;
  const text = [
    feature({
      id: 'w99',
      properties: { aerialway: 'chair_lift', name: 'Summit Express' },
      geometry: { type: 'LineString', coordinates: [[-122.02, 45.51], [-122.01, 45.52]] },
    }),
    // A station drawn as a closed way, built by osmium as an area.
    feature({
      id: 'w7',
      properties: { aerialway: 'station' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-122.0, 45.5], [-121.99, 45.5], [-121.99, 45.51], [-122.0, 45.5]]],
      },
    }),
    // Nodes (pylons) and one-point ways are not lift lines.
    feature({ id: 'n5', properties: { aerialway: 'pylon' }, geometry: { type: 'Point', coordinates: [0, 0] } }),
    feature({
      id: 'w8',
      properties: { aerialway: 'gondola' },
      geometry: { type: 'LineString', coordinates: [[0, 0]] },
    }),
    '',
  ].join('\r\n');

  it('keeps aerialway ways with geometry, in the same LiftLine shape as Overpass', () => {
    expect(parseGeojsonSeqAerialways(text)).toEqual([
      {
        id: '7',
        kind: 'station',
        coordinates: [
          { lat: 45.5, lng: -122.0 },
          { lat: 45.5, lng: -121.99 },
          { lat: 45.51, lng: -121.99 },
          { lat: 45.5, lng: -122.0 },
        ],
      },
      {
        id: '99',
        name: 'Summit Express',
        kind: 'chair_lift',
        coordinates: [
          { lat: 45.51, lng: -122.02 },
          { lat: 45.52, lng: -122.01 },
        ],
      },
    ]);
  });

  it('wraps the export as a snapshot the loader accepts', () => {
    const dataset = datasetFromOsmiumExport(text, {
      sourceName: 'planet-aerialways.geojsonseq',
      osmBaseAt: '2026-10-20T00:00:00Z',
    });
    expect(dataset.source).toBe('osmium:planet-aerialways.geojsonseq');
    expect(() => validateAerialwayDataset(dataset)).not.toThrow();
  });
});
