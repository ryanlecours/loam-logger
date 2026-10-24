/**
 * Local lift geometry snapshot: fetch it from Overpass, load it into Postgres,
 * or show what is loaded. See docs/lift-geometry-local.md for the runbook.
 *
 * Lift detection answers every ride from the ACTIVE LiftGeometryImport when
 * one exists, so production never has to reach Overpass. The fetch runs on a
 * machine that can reach an Overpass instance; the load runs anywhere that
 * can reach the target database.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/lift-geometry.ts fetch --out <file.json.gz>
 *       [--endpoint <overpass interpreter url>] [--tile-deg 45] [--pause-ms 2000]
 *       [--allow-untrusted-endpoint]   an endpoint other than overpass-api.de, e.g.
 *                                      one we self-host; blocked domains are refused
 *   npx tsx scripts/lift-geometry.ts convert --geojsonseq <aerialways.geojsonseq> --out <file.json.gz>
 *       [--osm-base <ISO date of the extract>]   (osmium fallback when Overpass will not serve)
 *   DATABASE_URL="…" npx tsx scripts/lift-geometry.ts load --in <file.json.gz>             # dry run
 *   DATABASE_URL="…" npx tsx scripts/lift-geometry.ts load --in <file.json.gz> --execute   # write
 *       [--allow-shrink]   accept a snapshot much smaller than the active one, or
 *                          under the floor a worldwide snapshot should clear
 *   DATABASE_URL="…" npx tsx scripts/lift-geometry.ts status
 *
 * `fetch` and `convert` touch no database. `load` is a dry run unless --execute is given,
 * and prints the database host it would write to either way.
 *
 * The snapshot file is OpenStreetMap data (ODbL 1.0, © OpenStreetMap
 * contributors). Keep it out of git: this repository is public.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { prisma } from '../src/lib/prisma';
import {
  DEFAULT_SNAPSHOT_ENDPOINT,
  DEFAULT_TILE_DEG,
  datasetFromOsmiumExport,
  fetchAerialwaySnapshot,
} from '../src/lib/lift-detection/aerialway-snapshot';
import {
  MAX_SHRINK_RATIO,
  MIN_SNAPSHOT_LINES,
  getActiveLiftGeometryImport,
  loadLiftGeometryDataset,
  validateAerialwayDataset,
} from '../src/lib/lift-detection/local-geometry';
import { isBlockedOverpassUrl } from '../src/lib/lift-detection/overpass';

type Args = {
  command?: string;
  out?: string;
  in?: string;
  geojsonseq?: string;
  osmBase?: string;
  endpoint: string;
  tileDeg: number;
  pauseMs: number;
  execute: boolean;
  allowShrink: boolean;
  allowUntrustedEndpoint: boolean;
};

function valueOf(argv: string[], i: number): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${argv[i]} needs a value`);
  return v;
}

function numberOf(argv: string[], i: number): number {
  const n = Number(valueOf(argv, i));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${argv[i]} must be a non-negative number`);
  return n;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0],
    endpoint: DEFAULT_SNAPSHOT_ENDPOINT,
    tileDeg: DEFAULT_TILE_DEG,
    pauseMs: 2_000,
    execute: false,
    allowShrink: false,
    allowUntrustedEndpoint: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = valueOf(argv, i++);
    else if (a === '--in') args.in = valueOf(argv, i++);
    else if (a === '--geojsonseq') args.geojsonseq = valueOf(argv, i++);
    else if (a === '--osm-base') args.osmBase = valueOf(argv, i++);
    else if (a === '--endpoint') args.endpoint = valueOf(argv, i++);
    else if (a === '--tile-deg') args.tileDeg = numberOf(argv, i++);
    else if (a === '--pause-ms') args.pauseMs = numberOf(argv, i++);
    else if (a === '--execute') args.execute = true;
    else if (a === '--allow-shrink') args.allowShrink = true;
    else if (a === '--allow-untrusted-endpoint') args.allowUntrustedEndpoint = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return args;
}

/** Host and database name only: the URL carries credentials. */
function describeDatabase(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

const summarize = (lines: Array<{ kind: string }>): string => {
  const byKind = new Map<string, number>();
  for (const l of lines) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + 1);
  return [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
};

async function fetchCommand(args: Args) {
  if (!args.out) throw new Error('fetch needs --out <file.json.gz>');
  console.log(`Fetching aerialways worldwide from ${args.endpoint} in ${args.tileDeg}° tiles`);
  const dataset = await fetchAerialwaySnapshot({
    endpoint: args.endpoint,
    allowUntrustedEndpoint: args.allowUntrustedEndpoint,
    tileDeg: args.tileDeg,
    pauseMs: args.pauseMs,
    log: (msg) => console.log(msg),
  });
  // Round-trip through the loader's own check so a file that fetch writes is
  // one that load accepts.
  validateAerialwayDataset(dataset);
  writeFileSync(args.out, gzipSync(JSON.stringify(dataset)));
  console.log(
    `\nWrote ${dataset.lines.length} lines (OSM base ${dataset.osmBaseAt ?? 'unknown'}) to ${args.out}` +
      `\nKinds: ${summarize(dataset.lines)}`
  );
}

async function convertCommand(args: Args) {
  if (!args.geojsonseq || !args.out) {
    throw new Error('convert needs --geojsonseq <aerialways.geojsonseq> and --out <file.json.gz>');
  }
  const dataset = validateAerialwayDataset(
    datasetFromOsmiumExport(readFileSync(args.geojsonseq, 'utf8'), {
      sourceName: basename(args.geojsonseq),
      osmBaseAt: args.osmBase ?? null,
    })
  );
  writeFileSync(args.out, gzipSync(JSON.stringify(dataset)));
  console.log(
    `Wrote ${dataset.lines.length} lines (OSM base ${dataset.osmBaseAt ?? 'unknown'}) to ${args.out}` +
      `\nKinds: ${summarize(dataset.lines)}`
  );
}

async function loadCommand(args: Args) {
  if (!args.in) throw new Error('load needs --in <file.json.gz>');
  const raw = readFileSync(args.in);
  const text = args.in.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const dataset = validateAerialwayDataset(JSON.parse(text));
  // A file fetched before the endpoint guard existed, or by hand, still
  // records where it came from.
  if (dataset.source.startsWith('overpass:') && isBlockedOverpassUrl(dataset.source.slice('overpass:'.length))) {
    throw new Error(`Refusing a snapshot from a blocked domain (${dataset.source})`);
  }
  const target = describeDatabase();

  console.log(
    `\nLift geometry load: ${args.execute ? 'EXECUTE (will write)' : 'DRY RUN (no writes)'}` +
      `\n  Target database: ${target}` +
      `\n  Snapshot: ${dataset.lines.length} lines from ${dataset.source}, OSM base ${dataset.osmBaseAt ?? 'unknown'}` +
      `\n  Kinds: ${summarize(dataset.lines)}`
  );

  const active = await getActiveLiftGeometryImport();
  console.log(
    active
      ? `  Active import: ${active.id}, ${active.lineCount} lines, OSM base ${active.osmBaseAt?.toISOString() ?? 'unknown'}`
      : '  Active import: none (lift detection is using Overpass)'
  );
  if (dataset.lines.length < MIN_SNAPSHOT_LINES) {
    console.log(
      `  WARNING: under ${MIN_SNAPSHOT_LINES} lines, too few for a worldwide snapshot;` +
        ` the load refuses it without --allow-shrink`
    );
  }
  if (active && dataset.lines.length < active.lineCount * MAX_SHRINK_RATIO) {
    console.log(
      `  WARNING: snapshot is under ${MAX_SHRINK_RATIO * 100}% of the active import;` +
        ` the load refuses it without --allow-shrink`
    );
  }

  if (!args.execute) {
    console.log('\nDry run only. Re-run with --execute to load.');
    return;
  }

  const result = await loadLiftGeometryDataset(dataset, {
    allowShrink: args.allowShrink,
    log: (msg) => console.log(`  ${msg}`),
  });
  console.log(`\nLoaded and activated import ${result.importId} (${result.lineCount} lines).`);
}

async function statusCommand() {
  console.log(`Database: ${describeDatabase()}\n`);
  const imports = await prisma.liftGeometryImport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      source: true,
      osmBaseAt: true,
      lineCount: true,
      createdAt: true,
      activatedAt: true,
      _count: { select: { lines: true } },
    },
  });
  if (imports.length === 0) {
    console.log('No imports. Lift detection is using Overpass.');
    return;
  }
  for (const i of imports) {
    console.log(
      `${i.status.padEnd(10)} ${i.id}  ${i.lineCount} lines (${i._count.lines} stored)` +
        `  OSM base ${i.osmBaseAt?.toISOString() ?? 'unknown'}` +
        `  created ${i.createdAt.toISOString()}  ${i.source}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'fetch') await fetchCommand(args);
  else if (args.command === 'convert') await convertCommand(args);
  else if (args.command === 'load') await loadCommand(args);
  else if (args.command === 'status') await statusCommand();
  else throw new Error('Command must be one of: fetch, convert, load, status');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
