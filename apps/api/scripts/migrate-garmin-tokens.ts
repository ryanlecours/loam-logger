/**
 * Migrate Garmin OAuth tokens off plaintext storage.
 *
 * Background: Garmin tokens were dual-written to `OauthToken` (plaintext) and
 * `UserIntegration` (AES-256-GCM). Everything now reads and writes only the
 * encrypted copy, so the plaintext rows are dead weight — and a bearer
 * credential sitting unencrypted in the database is exactly what a snapshot,
 * a read-replica, or a support-tooling leak turns into account access at
 * Garmin.
 *
 * Runtime already self-heals: the first time a pre-encryption connection is
 * used, `lib/garmin-token.ts` encrypts it into `UserIntegration` and deletes
 * the plaintext row. This script does the same thing eagerly, so accounts that
 * never sync do not leave plaintext behind indefinitely.
 *
 * What it does per Garmin `OauthToken` row:
 *   - no `UserIntegration` row  → encrypt into one, then delete the plaintext row
 *   - `UserIntegration` exists  → delete the plaintext row (already covered)
 *
 * DRY RUN BY DEFAULT: prints the plan and writes nothing. Pass --execute.
 *
 * Usage (from apps/api):
 *   DATABASE_URL="…" TOKEN_ENCRYPTION_KEY="…" npx tsx scripts/migrate-garmin-tokens.ts
 *   DATABASE_URL="…" TOKEN_ENCRYPTION_KEY="…" npx tsx scripts/migrate-garmin-tokens.ts --execute
 *
 * Safe to re-run: it is idempotent, and a second run should report zero rows.
 * Once it reports zero on a full run, `adoptLegacyPlaintextTokens` in
 * lib/garmin-token.ts and the status-endpoint fallback in routes/auth.garmin.ts
 * can both be deleted.
 */
import { PrismaClient } from '@prisma/client';
import { encrypt, validateEncryptionKey } from '../src/lib/crypto';

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

async function main() {
  // Fail before touching anything if the key is missing or malformed —
  // otherwise we would delete plaintext rows we could not re-encrypt.
  validateEncryptionKey();

  const legacyRows = await prisma.oauthToken.findMany({
    where: { provider: 'garmin' },
    select: {
      userId: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  if (legacyRows.length === 0) {
    console.log('No plaintext Garmin tokens found. Nothing to do.');
    return;
  }

  console.log(
    `${EXECUTE ? 'MIGRATING' : 'DRY RUN —'} ${legacyRows.length} plaintext Garmin token row(s)\n`
  );

  let encrypted = 0;
  let alreadyCovered = 0;
  let failed = 0;

  for (const row of legacyRows) {
    const existing = await prisma.userIntegration.findUnique({
      where: { userId_provider: { userId: row.userId, provider: 'GARMIN' } },
      select: { id: true, revokedAt: true },
    });

    // Never resurrect a revoked connection: if the integration exists at all,
    // the encrypted store is authoritative and the plaintext row is stale.
    const action = existing ? 'delete-only (already migrated)' : 'encrypt + delete';
    console.log(`  user ${row.userId}: ${action}`);

    if (!EXECUTE) {
      if (existing) alreadyCovered++;
      else encrypted++;
      continue;
    }

    try {
      const account = await prisma.userAccount.findFirst({
        where: { userId: row.userId, provider: 'garmin' },
        select: { providerUserId: true },
      });

      await prisma.$transaction(async (tx) => {
        if (!existing) {
          await tx.userIntegration.create({
            data: {
              userId: row.userId,
              provider: 'GARMIN',
              externalUserId: account?.providerUserId ?? null,
              accessTokenEnc: encrypt(row.accessToken),
              refreshTokenEnc: row.refreshToken ? encrypt(row.refreshToken) : null,
              expiresAt: row.expiresAt,
              connectedAt: row.createdAt,
            },
          });
        }

        await tx.oauthToken.deleteMany({
          where: { userId: row.userId, provider: 'garmin' },
        });
      });

      if (existing) alreadyCovered++;
      else encrypted++;
    } catch (err) {
      failed++;
      console.error(`    FAILED for user ${row.userId}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `\n${EXECUTE ? 'Done' : 'Dry run complete'} — ` +
      `${encrypted} encrypted, ${alreadyCovered} already migrated, ${failed} failed.`
  );
  if (!EXECUTE) console.log('Re-run with --execute to apply.');
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
