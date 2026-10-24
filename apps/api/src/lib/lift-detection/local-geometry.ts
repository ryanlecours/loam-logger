/**
 * Local copy of OpenStreetMap aerialway geometry (LiftGeometryImport and
 * LiftGeometryLine), so lift detection does not depend on reaching Overpass
 * at ride time.
 *
 * There are only tens of thousands of aerialway ways worldwide and they change
 * on a scale of years, so a periodically refreshed snapshot answers every ride
 * as well as a live query would. scripts/lift-geometry.ts fetches the snapshot
 * from a machine that can reach Overpass (see aerialway-snapshot.ts) and loads
 * it here. While an import is ACTIVE, getLiftLines uses it exclusively; an
 * environment with no import falls back to the Overpass path unchanged.
 *
 * OSM data is © OpenStreetMap contributors, available under the ODbL 1.0.
 * The snapshot is an unmodified, tag-filtered extract; see
 * docs/lift-geometry-local.md for the attribution this obliges.
 */

import { prisma } from '../prisma';
import { logger } from '../logger';
import type { LiftLine } from './detector';

export const AERIALWAY_DATASET_FORMAT = 'loam-aerialways/1';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_LICENSE = 'ODbL-1.0';

/** The snapshot file scripts/lift-geometry.ts writes and loads. */
export interface AerialwayDataset {
  format: typeof AERIALWAY_DATASET_FORMAT;
  /** Where the snapshot came from, e.g. `overpass:<endpoint>`. */
  source: string;
  /** OSM database time the snapshot reflects (ISO), when the source says. */
  osmBaseAt: string | null;
  generatedAt: string;
  license: typeof OSM_LICENSE;
  attribution: typeof OSM_ATTRIBUTION;
  lines: LiftLine[];
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface ActiveLiftGeometryImport {
  id: string;
  source: string;
  osmBaseAt: Date | null;
  lineCount: number;
  activatedAt: Date | null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parses an untrusted snapshot file. Throws with the first problem found, so
 * a truncated or hand-edited file is refused before anything is written.
 */
export function validateAerialwayDataset(value: unknown): AerialwayDataset {
  const d = value as Partial<AerialwayDataset> | null;
  if (!d || typeof d !== 'object') throw new Error('Snapshot is not a JSON object');
  if (d.format !== AERIALWAY_DATASET_FORMAT) {
    throw new Error(`Snapshot format must be ${AERIALWAY_DATASET_FORMAT} (got ${String(d.format)})`);
  }
  if (typeof d.source !== 'string' || d.source.length === 0) throw new Error('Snapshot has no source');
  if (d.osmBaseAt != null && Number.isNaN(new Date(d.osmBaseAt).getTime())) {
    throw new Error(`Snapshot osmBaseAt is not a date (got ${String(d.osmBaseAt)})`);
  }
  if (!Array.isArray(d.lines) || d.lines.length === 0) throw new Error('Snapshot has no lines');

  const seen = new Set<string>();
  d.lines.forEach((line, i) => {
    if (!line || typeof line.id !== 'string' || line.id.length === 0) {
      throw new Error(`Line ${i} has no id`);
    }
    if (seen.has(line.id)) throw new Error(`Line ${line.id} appears twice`);
    seen.add(line.id);
    if (typeof line.kind !== 'string') throw new Error(`Line ${line.id} has no kind`);
    if (line.name != null && typeof line.name !== 'string') {
      throw new Error(`Line ${line.id} has a non-string name`);
    }
    if (!Array.isArray(line.coordinates) || line.coordinates.length < 2) {
      throw new Error(`Line ${line.id} has fewer than two coordinates`);
    }
    for (const c of line.coordinates) {
      if (
        !c ||
        !isFiniteNumber(c.lat) ||
        !isFiniteNumber(c.lng) ||
        Math.abs(c.lat) > 90 ||
        Math.abs(c.lng) > 180
      ) {
        throw new Error(`Line ${line.id} has an invalid coordinate`);
      }
    }
  });

  return {
    format: AERIALWAY_DATASET_FORMAT,
    source: d.source,
    osmBaseAt: d.osmBaseAt ?? null,
    generatedAt: typeof d.generatedAt === 'string' ? d.generatedAt : new Date().toISOString(),
    license: OSM_LICENSE,
    attribution: OSM_ATTRIBUTION,
    lines: d.lines,
  };
}

export function lineBounds(line: LiftLine): BoundingBox {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const c of line.coordinates) {
    if (c.lat < south) south = c.lat;
    if (c.lat > north) north = c.lat;
    if (c.lng < west) west = c.lng;
    if (c.lng > east) east = c.lng;
  }
  return { south, west, north, east };
}

/** The import getLiftLines answers from, or null when there is none. Never throws. */
export async function getActiveLiftGeometryImport(): Promise<ActiveLiftGeometryImport | null> {
  try {
    return await prisma.liftGeometryImport.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { activatedAt: 'desc' },
      select: { id: true, source: true, osmBaseAt: true, lineCount: true, activatedAt: true },
    });
  } catch (err) {
    logger.warn({ err }, '[LiftGeometry] Active import lookup failed');
    return null;
  }
}

/**
 * Lift lines whose bounding box overlaps `bbox`, from the active import. Null
 * when there is no active import (or the read fails), meaning the caller
 * should use Overpass instead; an empty array is a real "no lifts here".
 * Bbox overlap is a superset of what an Overpass bbox query returns, which is
 * harmless: the detector measures distance to each line. Never throws.
 */
export async function queryLocalLiftLines(bbox: BoundingBox): Promise<LiftLine[] | null> {
  const active = await getActiveLiftGeometryImport();
  if (!active) return null;
  try {
    // Filtered on the relation rather than on active.id, so a load that
    // swaps imports between the two reads still answers from a complete set.
    const rows = await prisma.liftGeometryLine.findMany({
      where: {
        import: { status: 'ACTIVE' },
        minLat: { lte: bbox.north },
        maxLat: { gte: bbox.south },
        minLng: { lte: bbox.east },
        maxLng: { gte: bbox.west },
      },
      select: { osmId: true, name: true, kind: true, coordinates: true },
    });
    return rows.map((r) => ({
      id: r.osmId,
      ...(r.name != null ? { name: r.name } : {}),
      kind: r.kind,
      coordinates: r.coordinates as unknown as LiftLine['coordinates'],
    }));
  } catch (err) {
    logger.warn({ err }, '[LiftGeometry] Local line query failed');
    return null;
  }
}

/**
 * A new snapshot this much smaller than the active one is more likely a
 * truncated fetch than lifts coming down, so the load refuses it unless told
 * otherwise. OSM's aerialway count only grows in practice.
 */
export const MAX_SHRINK_RATIO = 0.9;
/**
 * The floor for any snapshot, the first one included. A regional Overpass
 * instance (overpass.osm.ch serves Switzerland only) answers a worldwide
 * fetch without error and yields a small, "complete" snapshot that would load
 * as "no lifts" for the rest of the world. A worldwide snapshot is several
 * times this size.
 */
export const MIN_SNAPSHOT_LINES = 10_000;
const INSERT_BATCH = 500;
/**
 * A LOADING import younger than this is taken to be another load still
 * running, and an older one to be abandoned. A worldwide load takes a minute
 * or two, so an hour leaves a wide margin either way.
 */
export const LOADING_STALE_MS = 60 * 60 * 1000;

export interface LoadResult {
  importId: string;
  lineCount: number;
  previous: ActiveLiftGeometryImport | null;
}

/**
 * Writes a snapshot as a new import and makes it the active one. Lines are
 * inserted under a LOADING import that no reader looks at, then one
 * transaction supersedes the old import and activates the new; the old
 * import's lines are deleted afterwards, keeping its row as history. A load
 * whose inserts fail deletes its own import; one killed part way leaves a
 * LOADING import, which the next load clears once it is stale. A load
 * refuses to start while a recent LOADING import exists, so a second load
 * started during the first is turned away rather than clearing its rows.
 * The check is not atomic: two loads started in the same instant can both
 * pass, write separate imports, and the later activation wins. Fine for a
 * command run by hand twice a year.
 */
export async function loadLiftGeometryDataset(
  dataset: AerialwayDataset,
  opts: { allowShrink?: boolean; log?: (msg: string) => void } = {}
): Promise<LoadResult> {
  const log = opts.log ?? (() => undefined);
  if (!opts.allowShrink && dataset.lines.length < MIN_SNAPSHOT_LINES) {
    throw new Error(
      `Snapshot has ${dataset.lines.length} lines, under the ${MIN_SNAPSHOT_LINES} a worldwide snapshot ` +
        'should have; refusing it (a regional Overpass instance? pass allowShrink if it is real)'
    );
  }
  const previous = await prisma.liftGeometryImport.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { activatedAt: 'desc' },
    select: { id: true, source: true, osmBaseAt: true, lineCount: true, activatedAt: true },
  });
  if (
    previous &&
    !opts.allowShrink &&
    dataset.lines.length < previous.lineCount * MAX_SHRINK_RATIO
  ) {
    throw new Error(
      `Snapshot has ${dataset.lines.length} lines against ${previous.lineCount} in the active import; ` +
        'refusing a shrink this large (pass allowShrink if it is real)'
    );
  }

  const staleBefore = new Date(Date.now() - LOADING_STALE_MS);
  const inFlight = await prisma.liftGeometryImport.findFirst({
    where: { status: 'LOADING', createdAt: { gte: staleBefore } },
    select: { id: true, createdAt: true },
  });
  if (inFlight) {
    throw new Error(
      `Import ${inFlight.id} has been loading since ${inFlight.createdAt.toISOString()}; ` +
        'another load is probably running. Wait for it, or retry after an hour if it died.'
    );
  }
  const abandoned = await prisma.liftGeometryImport.deleteMany({
    where: { status: 'LOADING', createdAt: { lt: staleBefore } },
  });
  if (abandoned.count > 0) log(`Cleared ${abandoned.count} abandoned LOADING import(s)`);

  const created = await prisma.liftGeometryImport.create({
    data: {
      source: dataset.source,
      osmBaseAt: dataset.osmBaseAt ? new Date(dataset.osmBaseAt) : null,
      lineCount: dataset.lines.length,
    },
    select: { id: true },
  });

  try {
    for (let i = 0; i < dataset.lines.length; i += INSERT_BATCH) {
      const batch = dataset.lines.slice(i, i + INSERT_BATCH);
      await prisma.liftGeometryLine.createMany({
        data: batch.map((line) => {
          const b = lineBounds(line);
          return {
            importId: created.id,
            osmId: line.id,
            name: line.name ?? null,
            kind: line.kind,
            coordinates: line.coordinates as unknown as object[],
            minLat: b.south,
            maxLat: b.north,
            minLng: b.west,
            maxLng: b.east,
          };
        }),
      });
      log(`Inserted ${Math.min(i + INSERT_BATCH, dataset.lines.length)} / ${dataset.lines.length}`);
    }
  } catch (err) {
    // Best effort: the lines cascade with the import. If this fails too, the
    // next load clears it once stale.
    await prisma.liftGeometryImport.delete({ where: { id: created.id } }).catch(() => undefined);
    throw err;
  }

  await prisma.$transaction([
    prisma.liftGeometryImport.updateMany({
      where: { status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    }),
    prisma.liftGeometryImport.update({
      where: { id: created.id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    }),
  ]);
  log(`Activated import ${created.id}`);

  const removed = await prisma.liftGeometryLine.deleteMany({
    where: { import: { status: 'SUPERSEDED' } },
  });
  if (removed.count > 0) log(`Removed ${removed.count} lines of superseded imports`);

  return { importId: created.id, lineCount: dataset.lines.length, previous };
}
