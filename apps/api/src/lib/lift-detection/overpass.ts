/**
 * OpenStreetMap aerialway lookup for Layer A, cached per grid cell in the
 * OverpassCache table (WeatherCache/GeoCache precedent).
 *
 * Overpass is a free, rate-limited, community-run service, so this module is
 * strictly best-effort: it never throws. When a live query fails, callers get
 * `geometryAvailable: false` plus whatever cached lines exist, and detection
 * degrades to kinematic-only (plan §3.2).
 */

import { prisma } from '../prisma';
import { logger } from '../logger';
import type { LiftLine, RidePoint } from './detector';

const OVERPASS_API_BASE =
  process.env.OVERPASS_API_BASE || 'https://overpass-api.de/api/interpreter';
// Identify ourselves per Overpass usage policy.
const USER_AGENT = 'loam-logger (component wear tracking; lift detection)';

const CELL_SIZE_DEG = 0.05;
// Lift geometry changes on a scale of years; refresh lazily past this age.
const FRESH_MS = 180 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// A park ride is spatially compact. A bbox spanning more cells than this is a
// tour, not a park day; skip the geometry layer rather than hammer Overpass.
const MAX_CELLS = 12;

// Per-process courtesy throttle, same pattern (and caveats) as open-meteo.ts:
// with one API replica this serializes all Overpass traffic app-wide.
const MIN_INTERVAL_MS = Number(process.env.OVERPASS_MIN_INTERVAL_MS) || 1000;
let lastRequest = 0;
let mutex: Promise<void> = Promise.resolve();

const acquireSlot = async (): Promise<void> => {
  const myTurn = mutex;
  let release!: () => void;
  mutex = new Promise((resolve) => {
    release = resolve;
  });
  await myTurn;
  const elapsed = Date.now() - lastRequest;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequest = Date.now();
  release();
};

export interface LiftLinesResult {
  /**
   * True when every cell covering the ride was resolved from cache or a live
   * query. False means Overpass was unavailable (or the ride was too large to
   * query) and lift lines may be incomplete — detection should require the
   * stricter kinematic-only thresholds and persist geometryScore = null.
   */
  geometryAvailable: boolean;
  liftLines: LiftLine[];
}

/** Grid-cell keys (southwest corner, 2dp) covering the points' bounding box. */
export function cellKeysForPoints(points: Array<Pick<RidePoint, 'lat' | 'lng'>>): string[] {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
  }

  const keys: string[] = [];
  const latStart = Math.floor(south / CELL_SIZE_DEG);
  const latEnd = Math.floor(north / CELL_SIZE_DEG);
  const lngStart = Math.floor(west / CELL_SIZE_DEG);
  const lngEnd = Math.floor(east / CELL_SIZE_DEG);
  for (let latIdx = latStart; latIdx <= latEnd; latIdx++) {
    for (let lngIdx = lngStart; lngIdx <= lngEnd; lngIdx++) {
      keys.push(`${(latIdx * CELL_SIZE_DEG).toFixed(2)},${(lngIdx * CELL_SIZE_DEG).toFixed(2)}`);
    }
  }
  return keys;
}

function cellBounds(cellKey: string): { south: number; west: number; north: number; east: number } {
  const [south, west] = cellKey.split(',').map(Number);
  return { south, west, north: south + CELL_SIZE_DEG, east: west + CELL_SIZE_DEG };
}

export function buildOverpassQuery(cellKey: string): string {
  const { south, west, north, east } = cellBounds(cellKey);
  return `[out:json][timeout:25];
way["aerialway"](${south},${west},${north},${east});
out geom;`;
}

/** Parses the `out geom` response into LiftLine records. */
export function parseOverpassAerialways(response: {
  elements?: Array<{
    id: number;
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}): LiftLine[] {
  return (response.elements ?? [])
    .filter((el) => el.geometry && el.geometry.length > 1)
    .map((el) => ({
      id: String(el.id),
      name: el.tags?.name,
      kind: el.tags?.aerialway ?? 'unknown',
      coordinates: el.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })),
    }));
}

async function fetchCell(cellKey: string): Promise<LiftLine[]> {
  await acquireSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(OVERPASS_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(buildOverpassQuery(cellKey))}`,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error(`Overpass request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Overpass request failed: ${res.status}`);
  }
  return parseOverpassAerialways(await res.json());
}

/**
 * Lift lines near a ride, from cache where fresh, from Overpass otherwise.
 * Never throws.
 */
export async function getLiftLines(
  points: Array<Pick<RidePoint, 'lat' | 'lng'>>
): Promise<LiftLinesResult> {
  const cells = cellKeysForPoints(points);
  if (cells.length === 0) {
    return { geometryAvailable: false, liftLines: [] };
  }
  if (cells.length > MAX_CELLS) {
    logger.info(
      { cellCount: cells.length, max: MAX_CELLS },
      '[Overpass] Ride bbox too large for geometry layer, running kinematic-only'
    );
    return { geometryAvailable: false, liftLines: [] };
  }

  const byId = new Map<string, LiftLine>();
  let geometryAvailable = true;

  let cached: Array<{ cellKey: string; payload: unknown; isEmpty: boolean; fetchedAt: Date }>;
  try {
    cached = await prisma.overpassCache.findMany({ where: { cellKey: { in: cells } } });
  } catch (err) {
    logger.warn({ err }, '[Overpass] Cache read failed');
    cached = [];
  }
  const cachedByKey = new Map(cached.map((c) => [c.cellKey, c]));

  for (const cellKey of cells) {
    const entry = cachedByKey.get(cellKey);
    const isFresh = entry && Date.now() - entry.fetchedAt.getTime() < FRESH_MS;
    if (entry && isFresh) {
      if (!entry.isEmpty) {
        for (const line of entry.payload as LiftLine[]) byId.set(line.id, line);
      }
      continue;
    }

    // Once one live query fails, assume Overpass is down and stop trying —
    // stale cache (if any) is better than hammering a struggling service.
    if (!geometryAvailable) {
      if (entry && !entry.isEmpty) {
        for (const line of entry.payload as LiftLine[]) byId.set(line.id, line);
      }
      continue;
    }

    try {
      const lines = await fetchCell(cellKey);
      for (const line of lines) byId.set(line.id, line);
      await prisma.overpassCache.upsert({
        where: { cellKey },
        create: { cellKey, payload: lines as object[], isEmpty: lines.length === 0 },
        update: { payload: lines as object[], isEmpty: lines.length === 0, fetchedAt: new Date() },
      });
    } catch (err) {
      logger.warn({ cellKey, err }, '[Overpass] Cell fetch failed, degrading to kinematic-only');
      geometryAvailable = false;
      // A stale entry for this cell still beats nothing.
      if (entry && !entry.isEmpty) {
        for (const line of entry.payload as LiftLine[]) byId.set(line.id, line);
      }
    }
  }

  return { geometryAvailable, liftLines: [...byId.values()] };
}
