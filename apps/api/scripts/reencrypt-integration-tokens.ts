/**
 * Rotate TOKEN_ENCRYPTION_KEY without forcing every rider to reconnect.
 *
 * `lib/crypto` holds a single key with no version tag, so changing the key on
 * a running deployment makes every stored provider token undecryptable at
 * once. This script decrypts each `UserIntegration` row with the OLD key and
 * writes it back under the NEW key. See lib/reencrypt-integration-tokens.ts
 * for the guarantees (idempotent, conflict-safe, never destructive).
 *
 * DRY RUN BY DEFAULT: prints the plan and writes nothing. Pass --execute.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="…" \
 *   OLD_TOKEN_ENCRYPTION_KEY="<current 64-hex key>" \
 *   NEW_TOKEN_ENCRYPTION_KEY="<new 64-hex key>" \
 *   npx tsx scripts/reencrypt-integration-tokens.ts [--execute] [--batch=200] [--quiet]
 *
 * OLD_TOKEN_ENCRYPTION_KEY falls back to TOKEN_ENCRYPTION_KEY, so with a
 * production .env loaded only the NEW key needs to be supplied.
 *
 * Runbook (the API keeps running on the OLD key throughout steps 1-3):
 *   1. Dry run against production. Expect only `reencrypted`, `already-rotated`
 *      and `revoked`. Investigate any `undecryptable` row before continuing;
 *      the script will not touch those rows either way.
 *   2. Run with --execute. Every row now opens under the NEW key.
 *   3. Set TOKEN_ENCRYPTION_KEY to the NEW key on the API service and deploy.
 *   4. Wait until every OLD-key instance has fully stopped (on Railway, until
 *      the previous deployment shows as removed, not just the new one as
 *      active). Then run with --execute again, same OLD and NEW keys, to pick
 *      up any rows the old deployment refreshed between step 2 and its
 *      shutdown. Expect zero or a handful of `reencrypted`. An OLD-key write
 *      that lands after this pass would be stranded as undecryptable, which is
 *      why the wait matters.
 *   5. Only now revoke/forget the OLD key.
 *
 * Exit code is 1 if any row is `undecryptable`, `conflict` or `failed`, so a
 * clean run is one that exits 0.
 *
 * Output names rows by their `UserIntegration.id` and provider, never by user
 * id or token material, so the log can be kept with the incident notes.
 */
import { PrismaClient } from '@prisma/client';
import { parseEncryptionKey } from '../src/lib/crypto';
import {
  reencryptIntegrationTokens,
  type RowReport,
} from '../src/lib/reencrypt-integration-tokens';

const EXECUTE = process.argv.includes('--execute');
const QUIET = process.argv.includes('--quiet');
const batchArg = process.argv.find((a) => a.startsWith('--batch='));
const BATCH_SIZE = batchArg ? Number(batchArg.slice('--batch='.length)) : 200;
const MAX_BATCH_SIZE = 1000;

if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > MAX_BATCH_SIZE) {
  console.error(`--batch must be an integer from 1 to ${MAX_BATCH_SIZE}, got ${batchArg}`);
  process.exit(2);
}

const prisma = new PrismaClient();

async function main() {
  // Parse both keys before touching the database so a typo fails fast and
  // names which key is wrong.
  const oldKey = parseEncryptionKey(
    process.env.OLD_TOKEN_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY,
    'OLD_TOKEN_ENCRYPTION_KEY (or TOKEN_ENCRYPTION_KEY)'
  );
  const newKey = parseEncryptionKey(
    process.env.NEW_TOKEN_ENCRYPTION_KEY,
    'NEW_TOKEN_ENCRYPTION_KEY'
  );

  console.log(
    `${EXECUTE ? 'RE-ENCRYPTING' : 'DRY RUN —'} UserIntegration tokens ` +
      `(batch ${BATCH_SIZE})\n`
  );

  const onRow = (r: RowReport) => {
    // Quiet mode still surfaces anything that needs a human.
    const routine =
      r.outcome === 'reencrypted' ||
      r.outcome === 'already-rotated' ||
      r.outcome === 'revoked';
    if (QUIET && routine) return;
    const detail = r.detail ? ` (${r.detail})` : '';
    console.log(`  ${r.provider.padEnd(7)} ${r.id}: ${r.outcome}${detail}`);
  };

  const summary = await reencryptIntegrationTokens({
    store: prisma,
    oldKey,
    newKey,
    execute: EXECUTE,
    batchSize: BATCH_SIZE,
    onRow,
  });

  const c = summary.counts;
  console.log(
    `\n${EXECUTE ? 'Done' : 'Dry run complete'} — ${summary.scanned} row(s) scanned: ` +
      `${c.reencrypted} ${EXECUTE ? 're-encrypted' : 'to re-encrypt'}, ` +
      `${c['already-rotated']} already rotated, ${c.revoked} revoked, ` +
      `${c.undecryptable} undecryptable, ${c.conflict} conflict, ${c.failed} failed.`
  );
  if (!EXECUTE) console.log('Re-run with --execute to apply.');

  if (c.undecryptable + c.conflict + c.failed > 0) {
    process.exitCode = 1;
    if (c.conflict > 0) console.log('Conflicts are safe to resolve by re-running the script.');
    if (c.undecryptable > 0) {
      console.log(
        'Undecryptable rows were left untouched. They will not open under the new key ' +
          'either; those riders must reconnect the provider.'
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
