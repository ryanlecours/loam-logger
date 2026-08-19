/**
 * One-off backfill: give existing e-bikes their motor and battery components.
 *
 * Background: MOTOR and BATTERY became real ComponentType values (see the
 * 20260814120000 migration). New e-bikes get them automatically, because
 * buildBikeComponents walks the catalog and the EBIKE entries are applicable
 * whenever BikeSpec.isEbike is true. Bikes created before that ran have no such
 * components, so without this script their owners would see nothing at all.
 *
 * Both types are hours-only: they accrue ride hours but are absent from
 * COMPONENT_WEIGHTS, so they produce no service interval and no health state.
 * This script therefore cannot change any existing prediction, which is why it
 * does not bust the prediction cache: the other components on these bikes are
 * untouched, and these two never had an entry to invalidate.
 *
 * Mirrors buildBikeComponents exactly, writing all three rows it writes:
 * Component, BikeComponentInstall (so the bike history and slot UI see it), and
 * an initial ServiceLog at installedAt (so the canonical hours anchor matches
 * every other component). A backfilled bike ends up indistinguishable from one
 * created after the migration.
 *
 * Hours: components are created at 0 and then run through
 * recomputeComponentHours, which sums the owner's non-duplicate rides on that
 * bike since the anchor. Anchor is the acquisition date when the rider gave one,
 * else the bike row's createdAt. So a rider who has been logging rides for two
 * seasons sees those hours immediately rather than starting from today.
 *
 * IDEMPOTENT: a bike that already has a component of a given type is skipped for
 * that type, so re-running is safe and only fills gaps.
 *
 * ISOLATED PER BIKE: each bike gets its own transaction and its own try/catch,
 * so one bike failing on bad data or a connection blip rolls that bike back and
 * leaves the rest of the run to finish. Failures are listed at the end and set a
 * non-zero exit code. Combined with idempotency this means the recovery for a
 * partial run is simply to run it again: everything that committed is skipped,
 * and only the failures are retried.
 *
 * DRY RUN BY DEFAULT: prints the plan and writes NOTHING. Pass --execute to
 * commit.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="…" npx tsx scripts/backfill-ebike-components.ts             # dry run, all e-bikes
 *   DATABASE_URL="…" npx tsx scripts/backfill-ebike-components.ts --execute    # write
 *   …scripts/backfill-ebike-components.ts --user <userId>                      # scope to one rider
 *   …scripts/backfill-ebike-components.ts --limit 10                           # cap bikes processed
 */
import type { ComponentType, ComponentLocation } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { recomputeComponentHours } from '../src/lib/component-hours';
import { getEbikeOnlyComponentTypes, getComponentByType, getSlotKey } from '@loam/shared';

type Args = {
  execute: boolean;
  user?: string;
  limit?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') args.execute = true;
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--limit must be a positive number (got "${argv[i]}")`);
      args.limit = n;
    }
  }
  return args;
}

const fmtHours = (h: number): string => `${h.toFixed(1)}h`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const EBIKE_TYPES = getEbikeOnlyComponentTypes();

  if (EBIKE_TYPES.length === 0) {
    throw new Error('No EBIKE-category components in the catalog. Nothing to backfill.');
  }

  console.log(args.execute ? '=== EXECUTE ===' : '=== DRY RUN (pass --execute to write) ===');
  console.log(`Types: ${EBIKE_TYPES.join(', ')}\n`);

  const bikes = await prisma.bike.findMany({
    where: {
      isEbike: true,
      ...(args.user ? { userId: args.user } : {}),
    },
    select: {
      id: true,
      userId: true,
      nickname: true,
      manufacturer: true,
      model: true,
      createdAt: true,
      acquisitionDate: true,
      components: {
        // Retired components still occupy the slot conceptually: if a rider
        // already added and retired a motor, this script must not add a second
        // one behind their back.
        select: { type: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`Found ${bikes.length} e-bike(s)\n`);

  let created = 0;
  let skipped = 0;
  let bikesTouched = 0;
  const failures: { bike: string; error: string }[] = [];

  for (const bike of bikes) {
    const label = `${bike.nickname ?? `${bike.manufacturer} ${bike.model}`} (${bike.id})`;
    const existing = new Set(bike.components.map((c) => c.type as string));
    const missing = EBIKE_TYPES.filter((t) => !existing.has(t));

    // Count every type that was already present, not just the bikes where all
    // of them were. A bike that already has a motor but needs a battery has one
    // pre-existing type, and an all-or-nothing check would report it as zero,
    // undercounting exactly the partially-backfilled bikes a re-run produces.
    skipped += EBIKE_TYPES.length - missing.length;

    if (missing.length === 0) continue;

    // Matches buildBikeComponents: the acquisition date is the honest install
    // anchor when the rider gave one, because that is when the parts were
    // really on the bike. createdAt is the fallback.
    const installedAt = bike.acquisitionDate ?? bike.createdAt;

    console.log(`${label}`);
    console.log(`  anchor: ${installedAt.toISOString().slice(0, 10)}${bike.acquisitionDate ? ' (acquisition)' : ' (bike created)'}`);

    if (!args.execute) {
      for (const type of missing) {
        console.log(`  + ${type} (would create)`);
      }
      created += missing.length;
      bikesTouched++;
      console.log('');
      continue;
    }

    // The try wraps the transaction and NOTHING else. Anything after it has
    // already committed, so letting post-commit work share this catch would let
    // a throw there report a committed bike as "rolled back, nothing written",
    // which is a false negative in the very summary this reporting exists to
    // make trustworthy.
    let lines: string[];
    try {
      // The per-component lines are built inside the transaction and only
      // printed once it commits. Logging as we go would report components as
      // created even when a later statement rolls the whole thing back, which
      // is exactly the output an operator would trust when deciding whether to
      // re-run.
      lines = await prisma.$transaction(async (tx) => {
        const written: string[] = [];
        for (const type of missing) {
          const def = getComponentByType(type);
          const component = await tx.component.create({
            data: {
              type: type as ComponentType,
              location: 'NONE' as ComponentLocation,
              bikeId: bike.id,
              userId: bike.userId,
              // Same defaults buildBikeComponents uses for a catalog component
              // with no 99spokes key. The rider can edit these; the bike's own
              // motorMaker/batteryWh specs are deliberately NOT copied in, so a
              // backfilled bike and a newly created one look identical.
              brand: 'Stock',
              model: def?.displayName ?? type,
              isStock: true,
              hoursUsed: 0,
              installedAt,
              baselineWearPercent: 0,
              baselineMethod: 'DEFAULT',
              baselineConfidence: 'LOW',
              baselineSetAt: installedAt,
            },
            select: { id: true },
          });

          await tx.bikeComponentInstall.create({
            data: {
              userId: bike.userId,
              bikeId: bike.id,
              componentId: component.id,
              slotKey: getSlotKey(type, 'NONE'),
              installedAt,
            },
          });

          await tx.serviceLog.create({
            data: {
              componentId: component.id,
              performedAt: installedAt,
              hoursAtService: 0,
            },
          });

          // Created at 0 above; this credits the ride history that already sits
          // behind the anchor, which is the whole reason the backfill exists.
          const result = await recomputeComponentHours(tx, component.id);
          written.push(`  + ${type} -> ${fmtHours(result?.hours ?? 0)}`);
        }
        return written;
      });
    } catch (err) {
      // One bike's failure must not abandon the rest of the run. Its
      // transaction has already rolled back, so the bike is untouched rather
      // than half-written, and the script is idempotent, so a later re-run
      // retries exactly these and skips everything that succeeded.
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ bike: label, error: message });
      console.log(`  ! FAILED, rolled back, nothing written for this bike: ${message}`);
      console.log('');
      continue;
    }

    // Committed. Record the success before printing anything, so the counters
    // survive even if writing to stdout fails.
    created += lines.length;
    bikesTouched++;
    for (const line of lines) console.log(line);

    console.log('');
  }

  console.log('---');
  console.log(`${args.execute ? 'Created' : 'Would create'}: ${created} component(s) across ${bikesTouched} bike(s)`);
  if (skipped > 0) console.log(`Already present, skipped: ${skipped}`);

  if (failures.length > 0) {
    console.log(`\nFailed: ${failures.length} bike(s). Each rolled back on its own and wrote nothing,`);
    console.log('so every other bike in this run committed normally. Re-running retries only these.');
    for (const f of failures) console.log(`  - ${f.bike}: ${f.error}`);
    // Non-zero exit so a failure is visible to whatever ran this, rather than
    // being buried in output that otherwise reads like a clean run.
    process.exitCode = 1;
  }
  if (!args.execute) console.log('\nNothing was written. Re-run with --execute to commit.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
