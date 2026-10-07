/**
 * Populate the component counter columns added by migration
 * 20260927120000_component_lifetime_and_inspection_counters.
 *
 * Background: that migration adds priorHours, lifetimeHours, hoursSinceService
 * and hoursSinceInspection to Component, but cannot fill them in SQL — the
 * values depend on the tenure x ride x adjustment attribution rule that lives in
 * src/lib/component-counters.ts. The columns land at 0 and this script fills
 * them.
 *
 * Reads tolerate the gap in the meantime. Until a row's counters are computed
 * its countersComputedAt is NULL: the prediction engine falls back to summing
 * its ride window, the fast-path ride increment leaves its counters alone, and
 * the component history page computes them on first view. Any recompute in the
 * gap (a service, an install, a ride edit) also completes the row, refreshing
 * its service readings. So the gap shows legacy figures, never wrong new ones,
 * and there is no hard ordering between deploy and this run. Run it promptly
 * anyway: until it does, most parts show no lifetime figure.
 *
 * By default only rows with countersComputedAt NULL are processed, so a re-run
 * after completion is a no-op and a --limit run picks up where the last one
 * stopped. Pass --all to recompute every component from the ledger (idempotent,
 * converges to the same answer); use it after a bulk data repair.
 *
 * DRY RUN BY DEFAULT: prints what would change and writes NOTHING. Pass
 * --execute to persist.
 *
 * It also refreshes service readings, through the same recompute every
 * request uses. A reading (hoursAtService) is the part's lifetime hours as of
 * its date, and every reading a rider did not type in is re-derived from the
 * ledger. Before the migration, hoursAtService stored the since-service counter
 * instead; the new rule subtracts it from lifetimeHours, so left alone every
 * part serviced twice or more would read as overdue. The refresh moves those
 * rows onto the lifetime scale. All pre-migration rows are treated as derived:
 * old-scale values cannot be told apart from typed ones.
 *
 * Each component runs in its own transaction. A dry run performs the whole
 * recompute and then rolls it back, so its figures are the ones --execute
 * would write rather than figures computed from old-scale readings.
 *
 * `priorHours` is deliberately NOT inferred. It is a declared input — hours a
 * part accrued before Loam Logger saw it — and guessing it from the old
 * backdated-service hack would bake yesterday's workaround into today's column.
 * It stays 0 until a rider states otherwise.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="…" npx tsx scripts/backfill-component-counters.ts             # dry run, all users
 *   DATABASE_URL="…" npx tsx scripts/backfill-component-counters.ts --execute   # persist
 *   …scripts/backfill-component-counters.ts --user <userId>                     # scope to one user
 *   …scripts/backfill-component-counters.ts --limit 100                         # cap components
 *   …scripts/backfill-component-counters.ts --all                               # include computed rows
 */
import { prisma } from '../src/lib/prisma';
import {
  recomputeComponentCountersWithStats,
  type RecomputeResult,
} from '../src/lib/component-counters';

/** Thrown to roll back a dry-run transaction after its figures are read. */
class DryRunRollback extends Error {
  constructor(readonly result: RecomputeResult | null) {
    super('dry run rollback');
  }
}

type Args = { execute: boolean; all: boolean; userId?: string; limit?: number };

function parseArgs(argv: string[]): Args {
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  const rawLimit = at('--limit');
  // Fail loudly. `--limit abc` used to parse as NaN, which is falsy, so the run
  // went ahead with no limit at all: the opposite of what was asked.
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error(`--limit must be a positive integer, got "${rawLimit}"`);
  }
  return {
    execute: argv.includes('--execute'),
    all: argv.includes('--all'),
    userId: at('--user'),
    limit,
  };
}

async function main() {
  const { execute, all, userId, limit } = parseArgs(process.argv.slice(2));

  console.log(
    `[backfill-component-counters] ${execute ? 'EXECUTING' : 'DRY RUN'}` +
      `${userId ? ` user=${userId}` : ' all users'}${limit ? ` limit=${limit}` : ''}` +
      `${all ? ' (all rows)' : ' (uncomputed rows)'}`
  );

  const components = await prisma.component.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(all ? {} : { countersComputedAt: null }),
    },
    select: { id: true, userId: true, type: true, brand: true, model: true, hoursUsed: true },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`[backfill-component-counters] ${components.length} components to process`);

  let changed = 0;
  let failed = 0;
  // Components whose OLD hoursUsed exceeded their real lifetime are the ones the
  // anchored-window rule had overcharged. Worth reporting: these are the rows
  // whose health state will visibly change for riders.
  let overcharged = 0;
  let refreshedReadings = 0;

  for (const [i, component] of components.entries()) {
    try {
      const result = await prisma
        .$transaction(
          async (tx) => {
            const recomputed = await recomputeComponentCountersWithStats(tx, component.id);
            if (!execute) throw new DryRunRollback(recomputed);
            return recomputed;
          },
          { timeout: 30_000 }
        )
        .catch((err) => {
          if (err instanceof DryRunRollback) return err.result;
          throw err;
        });
      if (!result) {
        failed += 1;
        continue;
      }
      const { counters } = result;
      // Tallied after the transaction settles, so one that fails part-way and
      // rolls back cannot leave the total over-reporting.
      refreshedReadings += result.readingsRefreshed;

      const wasOvercharged = component.hoursUsed > counters.lifetimeHours + 0.01;
      if (wasOvercharged) {
        overcharged += 1;
        console.log(
          `  [overcharged] ${component.type} ${component.brand} ${component.model} ` +
            `(${component.id}): hoursUsed ${component.hoursUsed.toFixed(1)}h -> ` +
            `lifetime ${counters.lifetimeHours.toFixed(1)}h, ` +
            `sinceService ${counters.hoursSinceService.toFixed(1)}h`
        );
      }

      changed += 1;
    } catch (err) {
      failed += 1;
      console.error(`  [error] component ${component.id}:`, err);
    }

    if ((i + 1) % 250 === 0) {
      console.log(`  …${i + 1}/${components.length}`);
    }
  }

  console.log(
    `[backfill-component-counters] done: ${changed} processed, ${failed} failed, ` +
      `${overcharged} previously overcharged, ${refreshedReadings} service readings ${execute ? 'refreshed' : 'would be refreshed'}`
  );
  if (!execute) {
    console.log('[backfill-component-counters] DRY RUN — nothing was written. Re-run with --execute.');
  }
  // Prediction caches key off bikeId and will be recomputed on next read; the
  // engine reads these columns directly, so no explicit invalidation is needed.
}

main()
  .catch((err) => {
    console.error('[backfill-component-counters] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
