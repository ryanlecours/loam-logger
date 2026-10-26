/**
 * Backfill Ride.trackElevationGainMeters from stored GPS tracks.
 *
 * Background: the counted climb for a ride with a mapped lift is the recorded
 * climb scaled by the share of the track's climb that was not on a lift
 * (lib/ride-lift.ts countedElevationGainMeters). The track's climb is a new
 * column; the lift worker writes it on every analysis from now on, but rides
 * analyzed before it existed have NULL there, and the API falls back to a
 * plain subtraction for them, which can wipe out a whole ride's climb.
 *
 * This reads each ride's stored stream and writes the column. It never calls
 * a provider or re-runs detection, so segments and lift columns stay as they
 * are. Writes are compare-and-set on a NULL column, so a value the worker
 * wrote in the meantime is never replaced.
 *
 * DRY RUN BY DEFAULT: reads streams and prints what it would write. Pass
 * --execute to write.
 *
 * Scope: rides with at least one mapped lift segment (the only rides whose
 * counted climb reads the column). Pass --all for every ride with a stored
 * stream.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="..." npx tsx scripts/backfill-track-climb.ts              # dry run
 *   DATABASE_URL="..." npx tsx scripts/backfill-track-climb.ts --execute    # write
 *   ...scripts/backfill-track-climb.ts --limit 20                          # cap rides processed
 *   ...scripts/backfill-track-climb.ts --all                               # every ride with a stream
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { pointsFromStream } from '../src/lib/lift-detection';
import { MAPPED_LIFT_SEGMENT_WHERE, trackClimbMeters } from '../src/lib/ride-lift';
import type { NormalizedStreams } from '../src/lib/ride-streams';

type Args = { execute: boolean; all: boolean; limit?: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--all') args.all = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer (got "${argv[i]}")`);
      args.limit = n;
    }
  }
  return args;
}

// Streams are the largest rows we read; keep a page small.
const PAGE_SIZE = 25;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `\nTrack climb backfill: ${args.execute ? 'EXECUTE (writes)' : 'DRY RUN (no writes)'}, ` +
      `scope ${args.all ? 'every ride with a stored stream' : 'rides with a mapped lift'}` +
      `${args.limit ? `, limit ${args.limit}` : ''}\n`
  );

  const where: Prisma.RideWhereInput = {
    trackElevationGainMeters: null,
    stream: { isNot: null },
    ...(args.all ? {} : { segments: { some: MAPPED_LIFT_SEGMENT_WHERE } }),
  };
  const total = await prisma.ride.count({ where });
  console.log(`Rides to fill: ${total}`);

  let processed = 0;
  let written = 0;
  let noAltitude = 0;
  let cursor: string | undefined;

  while (!args.limit || processed < args.limit) {
    const take = args.limit ? Math.min(PAGE_SIZE, args.limit - processed) : PAGE_SIZE;
    const rides = await prisma.ride.findMany({
      where,
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        startTime: true,
        elevationGainMeters: true,
        stream: { select: { data: true } },
      },
    });
    if (rides.length === 0) break;
    cursor = rides[rides.length - 1].id;

    for (const ride of rides) {
      processed++;
      const points = ride.stream ? pointsFromStream(ride.stream.data as unknown as NormalizedStreams) : null;
      const climb = trackClimbMeters(points);
      if (climb == null) {
        noAltitude++;
        console.log(`  ${ride.id}  ${ride.startTime.toISOString().slice(0, 10)}  no usable altitude, left NULL`);
        continue;
      }
      console.log(
        `  ${ride.id}  ${ride.startTime.toISOString().slice(0, 10)}  ` +
          `recorded ${Math.round(ride.elevationGainMeters)} m, track ${Math.round(climb)} m`
      );
      if (args.execute) {
        const res = await prisma.ride.updateMany({
          where: { id: ride.id, trackElevationGainMeters: null },
          data: { trackElevationGainMeters: climb },
        });
        written += res.count;
      }
    }
  }

  console.log(
    `\nProcessed ${processed}, ${args.execute ? `wrote ${written}` : 'wrote nothing (dry run)'}, ` +
      `no usable altitude ${noAltitude}.\n`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
