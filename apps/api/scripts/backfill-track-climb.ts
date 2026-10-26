/**
 * Backfill or recompute Ride.trackElevationGainMeters from stored GPS tracks.
 *
 * Background: the counted climb for a ride with a lift is the recorded climb
 * scaled by the share of the track's climb that was not on a lift
 * (lib/ride-lift.ts countedElevationGainMeters). The track's climb is a
 * column the lift worker writes on every analysis; rides analyzed before it
 * existed have NULL there, and the API falls back to a plain subtraction for
 * them, which can wipe out a whole ride's climb.
 *
 * This reads each ride's stored stream and lift segments and writes the
 * column with trackClimbMeters, the same function and inputs the worker uses.
 * It never calls a provider or re-runs detection, so segments and lift
 * columns stay as they are.
 *
 * DRY RUN BY DEFAULT: reads streams and prints what it would write, then a
 * summary of track climb against recorded climb by recording source. Pass
 * --execute to write.
 *
 * Scope: rides with at least one segment matched to a mapped lift (the rides
 * whose counted climb can read the column). Pass --all for every ride with a
 * stored stream.
 *
 * Modes:
 *   default       fill rides whose column is NULL. Writes are compare-and-set
 *                 on NULL, so a value the worker wrote meanwhile is kept.
 *   --recompute   rewrite every ride in scope, filled or not. Use after the
 *                 track climb calculation changes (2026-10-26: the raw step
 *                 sum became a hysteresis-smoothed climb between lifts plus
 *                 each lift segment's net rise).
 *   --threshold N dry run only: compute with an N-meter hysteresis instead of
 *                 TRACK_CLIMB_HYSTERESIS_METERS, to compare thresholds on
 *                 real tracks before changing the constant.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="..." npx tsx scripts/backfill-track-climb.ts                       # dry run, fill NULLs
 *   DATABASE_URL="..." npx tsx scripts/backfill-track-climb.ts --execute             # fill NULLs
 *   DATABASE_URL="..." npx tsx scripts/backfill-track-climb.ts --recompute           # dry run, every ride in scope
 *   DATABASE_URL="..." npx tsx scripts/backfill-track-climb.ts --recompute --execute # rewrite every ride in scope
 *   ...scripts/backfill-track-climb.ts --threshold 8                                # dry run at 8 m
 *   ...scripts/backfill-track-climb.ts --limit 20 --all --quiet                     # cap rides, every stream, summary only
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { pointsFromStream } from '../src/lib/lift-detection';
import {
  MAPPED_LIFT_SEGMENT_WHERE,
  TRACK_CLIMB_HYSTERESIS_METERS,
  trackClimbMeters,
} from '../src/lib/ride-lift';
import type { NormalizedStreams } from '../src/lib/ride-streams';

type Args = {
  execute: boolean;
  all: boolean;
  recompute: boolean;
  quiet: boolean;
  limit?: number;
  threshold?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false, all: false, recompute: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--all') args.all = true;
    else if (a === '--recompute') args.recompute = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer (got "${argv[i]}")`);
      args.limit = n;
    } else if (a === '--threshold') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`--threshold must be a number of meters (got "${argv[i]}")`);
      args.threshold = n;
    } else throw new Error(`Unknown argument "${a}"`);
  }
  // The column must always hold what the worker would write, so a custom
  // threshold is for comparing only.
  if (args.execute && args.threshold != null && args.threshold !== TRACK_CLIMB_HYSTERESIS_METERS) {
    throw new Error('--threshold is for dry runs; change TRACK_CLIMB_HYSTERESIS_METERS to write a different one');
  }
  return args;
}

// Streams are the largest rows we read; keep a page small.
const PAGE_SIZE = 25;

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const threshold = args.threshold ?? TRACK_CLIMB_HYSTERESIS_METERS;
  console.log(
    `\nTrack climb ${args.recompute ? 'recompute' : 'backfill'}: ` +
      `${args.execute ? 'EXECUTE (writes)' : 'DRY RUN (no writes)'}, ` +
      `scope ${args.all ? 'every ride with a stored stream' : 'rides with a mapped lift'}, ` +
      `hysteresis ${threshold} m${args.limit ? `, limit ${args.limit}` : ''}\n`
  );

  const where: Prisma.RideWhereInput = {
    ...(args.recompute ? {} : { trackElevationGainMeters: null }),
    stream: { isNot: null },
    ...(args.all ? {} : { segments: { some: MAPPED_LIFT_SEGMENT_WHERE } }),
  };
  const total = await prisma.ride.count({ where });
  console.log(`Rides in scope: ${total}`);

  let processed = 0;
  let written = 0;
  let noAltitude = 0;
  let cursor: string | undefined;
  // track climb / recorded climb, per recording source, for the summary.
  const ratios = new Map<string, number[]>();

  while (!args.limit || processed < args.limit) {
    const take = args.limit ? Math.min(PAGE_SIZE, args.limit - processed) : PAGE_SIZE;
    // Keyset paging on id, not Prisma's cursor + skip: in fill mode a ride
    // written above drops out of `where` (its column is no longer NULL), and
    // a cursor on a row that no longer matches made skip: 1 pass over the
    // next valid ride, one per page. The first production run (2026-10-26)
    // missed 3 of 81 that way.
    const rides = await prisma.ride.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        startTime: true,
        elevationGainMeters: true,
        trackElevationGainMeters: true,
        stream: { select: { data: true, source: true } },
        // Every lift segment, as the worker passes every detected one.
        segments: { where: { kind: 'LIFT' }, select: { startIndex: true, endIndex: true } },
      },
    });
    if (rides.length === 0) break;
    cursor = rides[rides.length - 1].id;

    for (const ride of rides) {
      processed++;
      const points = ride.stream ? pointsFromStream(ride.stream.data as unknown as NormalizedStreams) : null;
      const climb = trackClimbMeters(points, ride.segments, threshold);
      const day = ride.startTime.toISOString().slice(0, 10);
      if (climb == null) {
        noAltitude++;
        if (!args.quiet) console.log(`  ${ride.id}  ${day}  no usable altitude, left as is`);
        continue;
      }
      const source = ride.stream?.source ?? 'unknown';
      if (ride.elevationGainMeters > 0) {
        const list = ratios.get(source) ?? [];
        list.push(climb / ride.elevationGainMeters);
        ratios.set(source, list);
      }
      if (!args.quiet) {
        const old = ride.trackElevationGainMeters;
        console.log(
          `  ${ride.id}  ${day}  ${source.padEnd(7)}  recorded ${Math.round(ride.elevationGainMeters)} m, ` +
            `track ${old == null ? '' : `${Math.round(old)} m -> `}${Math.round(climb)} m`
        );
      }
      if (args.execute) {
        const res = await prisma.ride.updateMany({
          where: args.recompute ? { id: ride.id } : { id: ride.id, trackElevationGainMeters: null },
          data: { trackElevationGainMeters: climb },
        });
        written += res.count;
      }
    }
  }

  console.log(
    `\nProcessed ${processed}, ${args.execute ? `wrote ${written}` : 'wrote nothing (dry run)'}, ` +
      `no usable altitude ${noAltitude}.`
  );
  console.log('Track climb / recorded climb by source (p10, median, p90):');
  for (const [source, xs] of [...ratios.entries()].sort()) {
    console.log(
      `  ${source.padEnd(8)} n=${String(xs.length).padStart(4)}  ` +
        `${pct(xs, 0.1).toFixed(2)}  ${median(xs).toFixed(2)}  ${pct(xs, 0.9).toFixed(2)}`
    );
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
