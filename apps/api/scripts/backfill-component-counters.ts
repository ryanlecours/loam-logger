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
 * Reads tolerate the gap in the meantime: the prediction engine falls back to
 * summing its ride window when hoursSinceService is still 0, and the GraphQL
 * layer keeps serving the legacy hoursUsed counter. So there is no hard ordering
 * requirement between deploy and this run — but until it runs, no component
 * shows a lifetime figure.
 *
 * IDEMPOTENT: recomputes from the ledger every time, so re-running is safe and
 * converges to the same answer. Run it again after any bulk data repair.
 *
 * DRY RUN BY DEFAULT: prints what would change and writes NOTHING. Pass
 * --execute to persist.
 *
 * It also rescales legacy ServiceLog rows. Before the migration, hoursAtService
 * stored the since-service counter at the time of service; the new rule
 * subtracts it from lifetimeHours, so it must be the LIFETIME reading as of
 * that date. Left alone, every part serviced twice or more would read as
 * overdue. Legacy rows are the ones in the migration's archive table, and a row
 * is only rescaled while its updatedAt still matches the archived copy: once
 * rescaled, or once a rider edits it after the deploy, it is left alone. Any
 * hoursAtService a rider typed in by hand before the migration was on the old
 * scale too, and is rescaled with the rest.
 *
 * Each component runs in its own transaction. A dry run performs the rescale
 * and then rolls it back, so its counter figures are the ones --execute would
 * write rather than figures computed from old-scale readings.
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
 */
import { prisma } from '../src/lib/prisma';
import { computeComponentCounters, lifetimeHoursAt } from '../src/lib/component-counters';

/** Thrown to roll back a dry-run transaction after its figures are read. */
class DryRunRollback extends Error {}

type Counters = Awaited<ReturnType<typeof computeComponentCounters>>;

type Args = { execute: boolean; userId?: string; limit?: number };

function parseArgs(argv: string[]): Args {
  const execute = argv.includes('--execute');
  const at = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const rawLimit = at('--limit');
  return {
    execute,
    userId: at('--user'),
    limit: rawLimit ? Number(rawLimit) : undefined,
  };
}

async function main() {
  const { execute, userId, limit } = parseArgs(process.argv.slice(2));

  console.log(
    `[backfill-component-counters] ${execute ? 'EXECUTING' : 'DRY RUN'}` +
      `${userId ? ` user=${userId}` : ' all users'}${limit ? ` limit=${limit}` : ''}`
  );

  const components = await prisma.component.findMany({
    where: userId ? { userId } : {},
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
  let rescaledLogs = 0;

  for (const [i, component] of components.entries()) {
    try {
      const counters = await prisma
        .$transaction(
          async (tx) => {
            const legacyLogs = await tx.$queryRaw<{ id: string; performedAt: Date }[]>`
              SELECT sl."id", sl."performedAt"
              FROM "ServiceLog" sl
              JOIN "loam_archive"."ServiceLog_pre_20260927" a ON a."id" = sl."id"
              WHERE sl."componentId" = ${component.id}
                AND sl."updatedAt" = a."updatedAt"`;
            for (const log of legacyLogs) {
              await tx.serviceLog.update({
                where: { id: log.id },
                data: { hoursAtService: await lifetimeHoursAt(tx, component.id, log.performedAt) },
              });
            }
            rescaledLogs += legacyLogs.length;

            const result = await computeComponentCounters(tx, component.id);
            if (result && execute) {
              await tx.component.update({
                where: { id: component.id },
                data: {
                  lifetimeHours: result.lifetimeHours,
                  hoursSinceService: result.hoursSinceService,
                  hoursSinceInspection: result.hoursSinceInspection,
                  hoursUsed: result.hoursSinceService,
                },
              });
            }
            if (!execute) throw new DryRunRollback(JSON.stringify(result));
            return result;
          },
          { timeout: 30_000 }
        )
        .catch((err) => {
          if (err instanceof DryRunRollback) return JSON.parse(err.message) as Counters;
          throw err;
        });
      if (!counters) {
        failed += 1;
        continue;
      }

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
      `${overcharged} previously overcharged, ${rescaledLogs} legacy service logs rescaled`
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
