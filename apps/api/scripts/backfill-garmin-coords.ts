/**
 * Repair backfill for Garmin rides missing start coordinates.
 *
 * Background: a field-name bug meant Garmin rides were stored with null
 * startLat/startLng (see lib/garmin-coords.ts), so they never got weather or
 * reverse-geocoded location. The ingestion code is now fixed, but existing
 * rows still have null coords. Garmin doesn't allow arbitrary re-reads of old
 * activity data — the compliant fix is to re-trigger Garmin's backfill over the
 * affected date range so Garmin re-delivers the activities via webhooks, which
 * the (now-fixed) processGarminCallback re-upserts with coords + weather.
 *
 * DRY RUN BY DEFAULT: prints the plan and fires NOTHING at Garmin. Pass
 * --execute to actually trigger backfill requests.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="…" npx tsx scripts/backfill-garmin-coords.ts               # dry run, all users
 *   DATABASE_URL="…" npx tsx scripts/backfill-garmin-coords.ts --execute      # fire Garmin requests
 *   …scripts/backfill-garmin-coords.ts --user <userId>                        # scope to one user
 *   …scripts/backfill-garmin-coords.ts --limit 5                              # cap users processed
 *   …scripts/backfill-garmin-coords.ts --since 2026-04-15                     # clamp range start
 *
 * Note: Garmin returns 409 for a range it has already backfilled and will NOT
 * re-send those activities — such rides can't be recovered this way and are
 * reported as duplicates. Rides originally imported via real-time ping (the
 * common case) have no prior backfill for their range, so they re-deliver.
 */
import { prisma } from '../src/lib/prisma';
import { getValidGarminToken } from '../src/lib/garmin-token';
import { triggerGarminBackfillChunks } from '../src/services/garmin-backfill';

type Args = {
  execute: boolean;
  user?: string;
  limit?: number;
  since?: Date;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--since') {
      const d = new Date(argv[++i]);
      if (Number.isNaN(d.getTime())) throw new Error(`--since must be a valid date (got "${argv[i]}")`);
      args.since = d;
    }
  }
  return args;
}

const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(
    `\nGarmin coord-repair backfill — ${args.execute ? 'EXECUTE (will call Garmin)' : 'DRY RUN (no Garmin calls)'}\n`
  );

  // One row per user with at least one null-coord Garmin ride, plus the date
  // span we need to cover.
  const grouped = await prisma.ride.groupBy({
    by: ['userId'],
    where: {
      garminActivityId: { not: null },
      startLat: null,
      ...(args.user ? { userId: args.user } : {}),
      ...(args.since ? { startTime: { gte: args.since } } : {}),
    },
    _count: { _all: true },
    _min: { startTime: true },
    _max: { startTime: true },
  });

  // Deterministic order (most-affected users first); apply --limit after sort.
  grouped.sort((a, b) => b._count._all - a._count._all);
  const targets = args.limit ? grouped.slice(0, args.limit) : grouped;

  if (targets.length === 0) {
    console.log('No Garmin rides with null coordinates found. Nothing to do.\n');
    await prisma.$disconnect();
    return;
  }

  let totalRides = 0;
  let usersTriggered = 0;
  let usersSkipped = 0;
  let chunksAccepted = 0;

  for (const g of targets) {
    const count = g._count._all;
    const minStart = g._min.startTime;
    const maxStart = g._max.startTime;
    totalRides += count;

    if (!minStart || !maxStart) {
      console.log(`user ${g.userId}: ${count} rides but no start times — skipping`);
      usersSkipped++;
      continue;
    }

    // Clamp the window start to --since if given, and end one day past the last
    // ride so its 30-day chunk is fully covered.
    const startDate = args.since && args.since > minStart ? args.since : minStart;
    const endDate = new Date(maxStart.getTime() + 24 * 60 * 60 * 1000);

    console.log(
      `user ${g.userId}: ${count} null-coord rides, range ${fmtDate(startDate)} → ${fmtDate(endDate)}`
    );

    if (!args.execute) {
      usersTriggered++; // "would trigger"
      continue;
    }

    const token = await getValidGarminToken(g.userId);
    if (!token) {
      console.log(`  ↳ SKIP: no valid Garmin token (disconnected or expired)`);
      usersSkipped++;
      continue;
    }

    try {
      const result = await triggerGarminBackfillChunks({ accessToken: token, startDate, endDate });
      chunksAccepted += result.totalChunks;
      usersTriggered++;
      const dupNote = result.allDuplicates ? ' (all duplicates — Garmin already backfilled this range)' : '';
      console.log(
        `  ↳ ${result.totalChunks} chunk(s) accepted${dupNote}` +
          (result.errors.length ? `; ${result.errors.length} note(s): ${result.errors.join('; ')}` : '')
      );
    } catch (err) {
      console.log(`  ↳ ERROR: ${err instanceof Error ? err.message : String(err)}`);
      usersSkipped++;
    }
  }

  console.log(
    `\nSummary: ${targets.length} user(s), ${totalRides} null-coord rides, ` +
      `${usersTriggered} ${args.execute ? 'triggered' : 'would trigger'}, ${usersSkipped} skipped` +
      (args.execute ? `, ${chunksAccepted} Garmin chunk(s) accepted` : '')
  );
  if (!args.execute) {
    console.log('Dry run only — re-run with --execute to fire Garmin backfill requests.');
  } else {
    console.log(
      'Activities will arrive asynchronously via Garmin webhooks; coords + weather ' +
        'repopulate as processGarminCallback re-upserts each ride.'
    );
  }
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
