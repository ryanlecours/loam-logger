import { decryptWithKey, encryptWithKey } from './crypto';

/**
 * Rotate `TOKEN_ENCRYPTION_KEY` by re-encrypting every stored provider token.
 *
 * `./crypto` holds a single key with no version tag in the ciphertext, so
 * changing TOKEN_ENCRYPTION_KEY on a running deployment makes every
 * `UserIntegration` row undecryptable at once (surfaced as `undecryptable` by
 * `getIntegrationTokens`) and would force every rider to reconnect Garmin,
 * Strava, WHOOP and Suunto. This module decrypts each row with the old key and
 * writes it back under the new one, so the key can change without that.
 *
 * Properties the runbook relies on:
 *
 *   - Idempotent. A row that already opens under the new key is left alone, so
 *     the pass can run before the deploy (while the API still writes with the
 *     old key) and again right after it (to catch rows the API refreshed in
 *     between). Both runs take the same OLD and NEW keys.
 *   - Safe against concurrent token refreshes. Each write is conditional on the
 *     ciphertext still being what was read; if the running API refreshed the
 *     tokens in the meantime the write is a no-op and the row is re-read.
 *   - Never destructive. Ciphertext that opens under neither key is reported
 *     and left exactly as it was. Revoked rows (empty access token) hold no
 *     credential and are skipped.
 *   - Never logs token material. Only ids, providers and counts.
 *
 * Only `UserIntegration` is covered: it is the only table that stores
 * ciphertext from `./crypto`. The legacy plaintext `OauthToken` rows are not
 * affected by a key change.
 */

/** The subset of `UserIntegration` the rotation reads and writes. */
export type IntegrationRow = {
  id: string;
  userId: string;
  provider: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
};

const ROW_SELECT = {
  id: true,
  userId: true,
  provider: true,
  accessTokenEnc: true,
  refreshTokenEnc: true,
} as const;

/**
 * The slice of PrismaClient the rotation needs. Typed structurally so tests can
 * drive it with an in-memory fake and so the script does not import `./prisma`
 * (which reads DATABASE_URL at module load).
 */
export interface IntegrationTokenStore {
  userIntegration: {
    findMany(args: {
      where?: { id?: { gt: string } };
      orderBy: { id: 'asc' };
      take: number;
      select: typeof ROW_SELECT;
    }): Promise<IntegrationRow[]>;
    findUnique(args: {
      where: { id: string };
      select: typeof ROW_SELECT;
    }): Promise<IntegrationRow | null>;
    updateMany(args: {
      where: { id: string; accessTokenEnc: string; refreshTokenEnc: string | null };
      data: { accessTokenEnc: string; refreshTokenEnc: string | null };
    }): Promise<{ count: number }>;
  };
}

export type RowOutcome =
  | 'reencrypted'
  | 'already-rotated'
  | 'revoked'
  | 'undecryptable'
  | 'conflict'
  | 'failed';

export type RowReport = {
  id: string;
  userId: string;
  provider: string;
  outcome: RowOutcome;
  /** Set for `undecryptable`, `conflict` and `failed`; never contains token material. */
  detail?: string;
};

export type ReencryptSummary = {
  execute: boolean;
  scanned: number;
  counts: Record<RowOutcome, number>;
  /**
   * Only the rows that need a human: `undecryptable`, `conflict` and `failed`.
   * Successful rows are counted, and streamed through `onRow`, but not kept, so
   * memory stays flat however large the table is.
   */
  rows: RowReport[];
};

const NEEDS_ATTENTION: ReadonlySet<RowOutcome> = new Set<RowOutcome>([
  'undecryptable',
  'conflict',
  'failed',
]);

export type ReencryptOptions = {
  store: IntegrationTokenStore;
  oldKey: Buffer;
  newKey: Buffer;
  /** Write changes. Defaults to false: plan only. */
  execute?: boolean;
  /** Rows fetched per page. */
  batchSize?: number;
  /** Attempts per row when a concurrent refresh changes it under us. */
  maxAttempts?: number;
  /** Called once per row as it is classified; used for progress output. */
  onRow?: (report: RowReport) => void;
};

export type CiphertextKey =
  | { key: 'new'; plaintext: string }
  | { key: 'old'; plaintext: string }
  | { key: 'none' };

/**
 * Which key, if any, a single ciphertext opens under.
 *
 * Checks the new key first: on a re-run most rows are already rotated, and a
 * failed GCM decrypt is the expensive path.
 */
export function classifyCiphertext(
  ciphertext: string,
  oldKey: Buffer,
  newKey: Buffer
): CiphertextKey {
  try {
    return { key: 'new', plaintext: decryptWithKey(ciphertext, newKey) };
  } catch {
    // fall through to the old key
  }
  try {
    return { key: 'old', plaintext: decryptWithKey(ciphertext, oldKey) };
  } catch {
    return { key: 'none' };
  }
}

export type RowPlan =
  | { outcome: 'reencrypted'; data: { accessTokenEnc: string; refreshTokenEnc: string | null } }
  | { outcome: 'already-rotated' | 'revoked' }
  | { outcome: 'undecryptable'; detail: string };

/**
 * Decide what to write for one row, without writing it.
 */
export function planRow(row: IntegrationRow, oldKey: Buffer, newKey: Buffer): RowPlan {
  // revokeIntegration() blanks the access token; there is nothing to protect.
  if (row.accessTokenEnc === '') return { outcome: 'revoked' };

  const access = classifyCiphertext(row.accessTokenEnc, oldKey, newKey);
  const refresh =
    row.refreshTokenEnc === null
      ? null
      : classifyCiphertext(row.refreshTokenEnc, oldKey, newKey);

  const unopenable: string[] = [];
  if (access.key === 'none') unopenable.push('accessTokenEnc');
  if (refresh && refresh.key === 'none') unopenable.push('refreshTokenEnc');
  if (access.key === 'none' || (refresh && refresh.key === 'none')) {
    return {
      outcome: 'undecryptable',
      detail: `${unopenable.join(', ')} opens under neither key`,
    };
  }

  if (access.key === 'new' && (refresh === null || refresh.key === 'new')) {
    return { outcome: 'already-rotated' };
  }

  // At least one field is still under the old key. Rewrite both so the row is
  // never left half-rotated; a field already under the new key is re-encrypted
  // with a fresh IV, which is harmless.
  return {
    outcome: 'reencrypted',
    data: {
      accessTokenEnc: encryptWithKey(access.plaintext, newKey),
      refreshTokenEnc:
        refresh === null ? null : encryptWithKey(refresh.plaintext, newKey),
    },
  };
}

function emptyCounts(): Record<RowOutcome, number> {
  return {
    reencrypted: 0,
    'already-rotated': 0,
    revoked: 0,
    undecryptable: 0,
    conflict: 0,
    failed: 0,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Walk every `UserIntegration` row and re-encrypt it from `oldKey` to `newKey`.
 *
 * With `execute: false` (the default) nothing is written; the summary says
 * what a real run would do. Refuses to run when the two keys are identical.
 */
export async function reencryptIntegrationTokens(
  opts: ReencryptOptions
): Promise<ReencryptSummary> {
  const { store, oldKey, newKey } = opts;
  const execute = opts.execute ?? false;
  const batchSize = opts.batchSize ?? 200;
  const maxAttempts = opts.maxAttempts ?? 3;

  if (oldKey.equals(newKey)) {
    throw new Error('Old and new encryption keys are identical; nothing to rotate');
  }

  const summary: ReencryptSummary = {
    execute,
    scanned: 0,
    counts: emptyCounts(),
    rows: [],
  };

  const record = (report: RowReport) => {
    summary.counts[report.outcome]++;
    if (NEEDS_ATTENTION.has(report.outcome)) summary.rows.push(report);
    opts.onRow?.(report);
  };

  let cursor: string | undefined;
  for (;;) {
    const page = await store.userIntegration.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: batchSize,
      select: ROW_SELECT,
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const initial of page) {
      summary.scanned++;
      record(await settleRow(initial, { store, oldKey, newKey, execute, maxAttempts }));
    }
  }

  return summary;
}

/**
 * Classify one row and, when executing, write it, retrying if the running API
 * changes it under us. Always resolves to exactly one report.
 */
async function settleRow(
  initial: IntegrationRow,
  ctx: {
    store: IntegrationTokenStore;
    oldKey: Buffer;
    newKey: Buffer;
    execute: boolean;
    maxAttempts: number;
  }
): Promise<RowReport> {
  const base = { id: initial.id, userId: initial.userId, provider: initial.provider };
  let row: IntegrationRow | null = initial;

  for (let attempt = 1; attempt <= ctx.maxAttempts && row; attempt++) {
    let plan: RowPlan;
    try {
      plan = planRow(row, ctx.oldKey, ctx.newKey);
    } catch (err) {
      return { ...base, outcome: 'failed', detail: errorMessage(err) };
    }

    if (plan.outcome === 'undecryptable') {
      return { ...base, outcome: plan.outcome, detail: plan.detail };
    }
    if (plan.outcome !== 'reencrypted') {
      return { ...base, outcome: plan.outcome };
    }
    if (!ctx.execute) {
      return { ...base, outcome: 'reencrypted' };
    }

    try {
      const { count } = await ctx.store.userIntegration.updateMany({
        // Conditional on the ciphertext we read: a concurrent refresh by the
        // running API changes it, and we must not overwrite newer tokens with
        // re-encrypted stale ones.
        where: {
          id: row.id,
          accessTokenEnc: row.accessTokenEnc,
          refreshTokenEnc: row.refreshTokenEnc,
        },
        data: plan.data,
      });
      if (count === 1) return { ...base, outcome: 'reencrypted' };

      // Lost the race; re-read and try again. A row deleted in the meantime
      // comes back null and ends the loop.
      row = await ctx.store.userIntegration.findUnique({
        where: { id: row.id },
        select: ROW_SELECT,
      });
    } catch (err) {
      return { ...base, outcome: 'failed', detail: errorMessage(err) };
    }
  }

  return {
    ...base,
    outcome: 'conflict',
    detail: row
      ? `row changed under us ${ctx.maxAttempts} times; re-run to pick it up`
      : 'row deleted during rotation',
  };
}
