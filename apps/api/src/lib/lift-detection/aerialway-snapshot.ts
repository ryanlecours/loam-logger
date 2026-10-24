/**
 * Builds a worldwide aerialway snapshot from an Overpass instance (or from an
 * osmium export, when no Overpass instance will serve the queries), for
 * scripts/lift-geometry.ts to load with loadLiftGeometryDataset. Runs on an
 * operator's machine, never inside the API: the point of the snapshot is
 * that production does not have to reach Overpass.
 *
 * The world is split into tiles queried one at a time with a pause between
 * them, which keeps each answer small and the load on a community-run
 * instance polite. A snapshot is all or nothing: a tile that still fails
 * after its retries aborts the run, because a missing tile would be loaded
 * as "no lifts here" for every ride in it.
 */

import { isBlockedOverpassUrl, parseOverpassAerialways } from './overpass';
import type { LiftLine } from './detector';
import {
  AERIALWAY_DATASET_FORMAT,
  OSM_ATTRIBUTION,
  OSM_LICENSE,
  type AerialwayDataset,
  type BoundingBox,
} from './local-geometry';

export const DEFAULT_SNAPSHOT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/**
 * Hosts a snapshot may come from without an override. The snapshot becomes
 * the lift geometry for every ride, so a broken or hostile instance would skew
 * detection everywhere. overpass-api.de is the main instance, run by FOSSGIS
 * e.V. for the OSM community. Any other instance (a self-hosted one, say)
 * needs `allowUntrustedEndpoint`; a blocked domain is refused even then.
 */
export const TRUSTED_SNAPSHOT_HOSTS = ['overpass-api.de'];

/** Throws unless the endpoint may serve a snapshot. */
export function assertSnapshotEndpoint(endpoint: string, allowUntrusted = false): void {
  if (isBlockedOverpassUrl(endpoint)) {
    throw new Error(`Refusing ${endpoint}: snapshots are never taken from a blocked domain`);
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing ${endpoint}: a snapshot endpoint must use https`);
  }
  if (!allowUntrusted && !TRUSTED_SNAPSHOT_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error(
      `Refusing ${endpoint}: not a trusted snapshot host (${TRUSTED_SNAPSHOT_HOSTS.join(', ')}); ` +
        'pass allowUntrustedEndpoint for an instance you run or have vetted'
    );
  }
}
const USER_AGENT = 'loam-logger (component wear tracking; lift geometry snapshot)';
// 32 tiles. The aerialway tag index keeps even a dense tile (the Alps and
// Scandinavia share one) cheap to answer, and fewer requests means fewer
// chances to land on a busy instance; finer tiles only add round trips.
export const DEFAULT_TILE_DEG = 45;

const QUERY_TIMEOUT_S = 180;
// Overpass may hold the connection for the whole server-side timeout before
// the body starts, so allow that plus the transfer.
const FETCH_TIMEOUT_MS = (QUERY_TIMEOUT_S + 60) * 1000;
// Overpass asks clients to wait at least 30s after a 429; later attempts back
// off further.
const RETRY_WAITS_MS = [30_000, 60_000, 120_000, 240_000];

/** Tiles of `tileDeg` degrees covering the whole globe, southwest first. */
export function worldTiles(tileDeg: number): BoundingBox[] {
  if (!(tileDeg > 0) || 180 % tileDeg !== 0) {
    throw new Error(`tileDeg must divide 180 evenly (got ${tileDeg})`);
  }
  const tiles: BoundingBox[] = [];
  for (let south = -90; south < 90; south += tileDeg) {
    for (let west = -180; west < 180; west += tileDeg) {
      tiles.push({ south, west, north: south + tileDeg, east: west + tileDeg });
    }
  }
  return tiles;
}

/** The same filter getLiftLines uses per cell, so the snapshot matches it. */
export function buildTileQuery(tile: BoundingBox): string {
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];
way["aerialway"](${tile.south},${tile.west},${tile.north},${tile.east});
out geom;`;
}

interface TileAnswer {
  lines: LiftLine[];
  osmBase: string | null;
}

class FatalTileError extends Error {}

async function fetchTile(
  endpoint: string,
  tile: BoundingBox,
  fetchImpl: typeof fetch
): Promise<TileAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(buildTileQuery(tile))}`,
      signal: controller.signal,
    });
    if (res.status === 400) {
      // A malformed query fails the same way on every attempt.
      throw new FatalTileError(`Overpass rejected the query: HTTP 400 ${await res.text()}`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as Parameters<typeof parseOverpassAerialways>[0] & {
      osm3s?: { timestamp_osm_base?: string };
      remark?: string;
    };
    // Overpass reports a server-side timeout or memory limit as a 200 with a
    // remark and a partial element list; that tile is not complete.
    if (body.remark && /error|timed out|out of memory/i.test(body.remark)) {
      throw new Error(`Overpass remark: ${body.remark}`);
    }
    return {
      lines: parseOverpassAerialways(body),
      osmBase: body.osm3s?.timestamp_osm_base ?? null,
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error(`no answer within ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface SnapshotOptions {
  endpoint?: string;
  /** Accept an endpoint outside TRUSTED_SNAPSHOT_HOSTS (never a blocked domain). */
  allowUntrustedEndpoint?: boolean;
  tileDeg?: number;
  /** Pause between tiles, as a courtesy to the instance. */
  pauseMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

/** Queries every tile and merges the answers. Throws if any tile fails for good. */
export async function fetchAerialwaySnapshot(opts: SnapshotOptions = {}): Promise<AerialwayDataset> {
  const endpoint = opts.endpoint ?? DEFAULT_SNAPSHOT_ENDPOINT;
  assertSnapshotEndpoint(endpoint, opts.allowUntrustedEndpoint);
  const pauseMs = opts.pauseMs ?? 2_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => undefined);
  const tiles = worldTiles(opts.tileDeg ?? DEFAULT_TILE_DEG);

  // A lift crossing a tile edge comes back from both tiles; key by OSM id.
  const byId = new Map<string, LiftLine>();
  // The oldest base across tiles is the age the whole snapshot can claim.
  let osmBaseAt: string | null = null;

  for (const [i, tile] of tiles.entries()) {
    if (i > 0) await sleep(pauseMs);
    const label = `tile ${i + 1}/${tiles.length} (${tile.south},${tile.west},${tile.north},${tile.east})`;
    let answer: TileAnswer | null = null;
    for (let attempt = 0; answer === null; attempt++) {
      try {
        answer = await fetchTile(endpoint, tile, fetchImpl);
      } catch (err) {
        const why = (err as Error).message;
        if (err instanceof FatalTileError || attempt >= RETRY_WAITS_MS.length) {
          throw new Error(`Snapshot aborted at ${label}: ${why}`);
        }
        log(`${label} failed (${why}); retrying in ${RETRY_WAITS_MS[attempt] / 1000}s`);
        await sleep(RETRY_WAITS_MS[attempt]);
      }
    }
    for (const line of answer.lines) byId.set(line.id, line);
    if (answer.osmBase && (osmBaseAt === null || answer.osmBase < osmBaseAt)) {
      osmBaseAt = answer.osmBase;
    }
    log(`${label}: ${answer.lines.length} lines, ${byId.size} total`);
  }

  return {
    format: AERIALWAY_DATASET_FORMAT,
    source: `overpass:${endpoint}`,
    osmBaseAt,
    generatedAt: new Date().toISOString(),
    license: OSM_LICENSE,
    attribution: OSM_ATTRIBUTION,
    lines: [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)),
  };
}

/**
 * Lift lines from an `osmium export -f geojsonseq --add-unique-id=type_id`
 * of aerialway ways (docs/lift-geometry-local.md has the full command), the
 * fallback source when no Overpass instance will serve a snapshot. Matches
 * parseOverpassAerialways: ways only, the aerialway tag as kind, and only
 * geometries with at least two points. A closed way that osmium built as an
 * area keeps its outer ring, as Overpass `out geom` would return it.
 */
const RECORD_SEPARATOR = String.fromCharCode(0x1e);

export function parseGeojsonSeqAerialways(text: string): LiftLine[] {
  const byId = new Map<string, LiftLine>();
  for (const raw of text.split(/\r?\n/)) {
    // RFC 8142 prefixes each record with an ASCII record separator.
    const record = (raw.startsWith(RECORD_SEPARATOR) ? raw.slice(1) : raw).trim();
    if (!record) continue;
    const feature = JSON.parse(record) as {
      id?: string | number;
      properties?: Record<string, unknown>;
      geometry?: { type: string; coordinates: unknown };
    };
    const rawId = String(feature.id ?? feature.properties?.['@id'] ?? '');
    const wayId = /^w?(\d+)$/.exec(rawId)?.[1];
    if (!wayId) continue;
    const kind = feature.properties?.aerialway;
    if (typeof kind !== 'string') continue;

    let positions: Array<[number, number]> | undefined;
    if (feature.geometry?.type === 'LineString') {
      positions = feature.geometry.coordinates as Array<[number, number]>;
    } else if (feature.geometry?.type === 'Polygon') {
      positions = (feature.geometry.coordinates as Array<Array<[number, number]>>)[0];
    } else if (feature.geometry?.type === 'MultiPolygon') {
      positions = (feature.geometry.coordinates as Array<Array<Array<[number, number]>>>)[0]?.[0];
    }
    if (!positions || positions.length < 2) continue;

    const name = feature.properties?.name;
    byId.set(wayId, {
      id: wayId,
      ...(typeof name === 'string' ? { name } : {}),
      kind,
      coordinates: positions.map(([lng, lat]) => ({ lat, lng })),
    });
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/** Wraps lines from an osmium export as a snapshot file. */
export function datasetFromOsmiumExport(
  text: string,
  opts: { sourceName: string; osmBaseAt: string | null }
): AerialwayDataset {
  return {
    format: AERIALWAY_DATASET_FORMAT,
    source: `osmium:${opts.sourceName}`,
    osmBaseAt: opts.osmBaseAt,
    generatedAt: new Date().toISOString(),
    license: OSM_LICENSE,
    attribution: OSM_ATTRIBUTION,
    lines: parseGeojsonSeqAerialways(text),
  };
}
