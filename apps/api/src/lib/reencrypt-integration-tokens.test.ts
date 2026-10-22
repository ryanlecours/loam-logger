import crypto from 'crypto';
import { decryptWithKey, encryptWithKey } from './crypto';
import {
  classifyCiphertext,
  planRow,
  reencryptIntegrationTokens,
  type IntegrationRow,
  type IntegrationTokenStore,
} from './reencrypt-integration-tokens';

const OLD_KEY = crypto.randomBytes(32);
const NEW_KEY = crypto.randomBytes(32);
const STRANGER_KEY = crypto.randomBytes(32);

/**
 * In-memory stand-in for the Prisma slice the rotation uses. Rows are sorted
 * by id on read, like the real cursor pagination. `onBeforeUpdate` lets a test
 * simulate the running API refreshing a token between our read and our
 * conditional write.
 */
function fakeStore(
  initial: IntegrationRow[],
  hooks: { onBeforeUpdate?: (id: string, attempt: number) => void } = {}
) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const updateAttempts = new Map<string, number>();
  const calls = { findMany: 0, updateMany: 0, findUnique: 0 };

  const store: IntegrationTokenStore = {
    userIntegration: {
      async findMany(args) {
        calls.findMany++;
        const after = args.where?.id?.gt;
        return [...rows.values()]
          .filter((r) => (after === undefined ? true : r.id > after))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .slice(0, args.take)
          .map((r) => ({ ...r }));
      },
      async findUnique(args) {
        calls.findUnique++;
        const r = rows.get(args.where.id);
        return r ? { ...r } : null;
      },
      async updateMany(args) {
        calls.updateMany++;
        const attempt = (updateAttempts.get(args.where.id) ?? 0) + 1;
        updateAttempts.set(args.where.id, attempt);
        hooks.onBeforeUpdate?.(args.where.id, attempt);
        const r = rows.get(args.where.id);
        if (
          !r ||
          r.accessTokenEnc !== args.where.accessTokenEnc ||
          r.refreshTokenEnc !== args.where.refreshTokenEnc
        ) {
          return { count: 0 };
        }
        r.accessTokenEnc = args.data.accessTokenEnc;
        r.refreshTokenEnc = args.data.refreshTokenEnc;
        return { count: 1 };
      },
    },
  };

  return { store, rows, calls };
}

function row(
  id: string,
  key: Buffer,
  access: string,
  refresh: string | null,
  provider = 'GARMIN'
): IntegrationRow {
  return {
    id,
    userId: `user-${id}`,
    provider,
    accessTokenEnc: encryptWithKey(access, key),
    refreshTokenEnc: refresh === null ? null : encryptWithKey(refresh, key),
  };
}

function expectReencrypted(plan: ReturnType<typeof planRow>) {
  if (plan.outcome !== 'reencrypted') {
    throw new Error(`expected reencrypted plan, got ${plan.outcome}`);
  }
  return plan.data;
}

describe('classifyCiphertext', () => {
  it('recognises ciphertext under the new key', () => {
    const ct = encryptWithKey('a', NEW_KEY);
    expect(classifyCiphertext(ct, OLD_KEY, NEW_KEY)).toEqual({ key: 'new', plaintext: 'a' });
  });

  it('recognises ciphertext under the old key and returns the plaintext', () => {
    const ct = encryptWithKey('secret-token', OLD_KEY);
    expect(classifyCiphertext(ct, OLD_KEY, NEW_KEY)).toEqual({
      key: 'old',
      plaintext: 'secret-token',
    });
  });

  it('reports ciphertext that opens under neither key', () => {
    const ct = encryptWithKey('a', STRANGER_KEY);
    expect(classifyCiphertext(ct, OLD_KEY, NEW_KEY)).toEqual({ key: 'none' });
    expect(classifyCiphertext('not-base64-ciphertext', OLD_KEY, NEW_KEY)).toEqual({
      key: 'none',
    });
  });
});

describe('planRow', () => {
  it('re-encrypts both fields from the old key and preserves the plaintext', () => {
    const data = expectReencrypted(planRow(row('1', OLD_KEY, 'access-1', 'refresh-1'), OLD_KEY, NEW_KEY));
    expect(decryptWithKey(data.accessTokenEnc, NEW_KEY)).toBe('access-1');
    expect(decryptWithKey(data.refreshTokenEnc as string, NEW_KEY)).toBe('refresh-1');
    // The old key must no longer open the new ciphertext.
    expect(() => decryptWithKey(data.accessTokenEnc, OLD_KEY)).toThrow();
  });

  it('keeps a null refresh token null', () => {
    const data = expectReencrypted(planRow(row('1', OLD_KEY, 'access', null), OLD_KEY, NEW_KEY));
    expect(data.refreshTokenEnc).toBeNull();
  });

  it('leaves rows already under the new key alone', () => {
    expect(planRow(row('1', NEW_KEY, 'a', 'r'), OLD_KEY, NEW_KEY)).toEqual({
      outcome: 'already-rotated',
    });
  });

  it('repairs a half-rotated row by rewriting both fields under the new key', () => {
    const r: IntegrationRow = {
      id: '1',
      userId: 'u',
      provider: 'STRAVA',
      accessTokenEnc: encryptWithKey('access', NEW_KEY),
      refreshTokenEnc: encryptWithKey('refresh', OLD_KEY),
    };
    const data = expectReencrypted(planRow(r, OLD_KEY, NEW_KEY));
    expect(decryptWithKey(data.accessTokenEnc, NEW_KEY)).toBe('access');
    expect(decryptWithKey(data.refreshTokenEnc as string, NEW_KEY)).toBe('refresh');
  });

  it('skips revoked rows, which hold no credential', () => {
    const r: IntegrationRow = {
      id: '1',
      userId: 'u',
      provider: 'GARMIN',
      accessTokenEnc: '',
      refreshTokenEnc: null,
    };
    expect(planRow(r, OLD_KEY, NEW_KEY)).toEqual({ outcome: 'revoked' });
  });

  it('reports undecryptable fields by name without touching them', () => {
    const r: IntegrationRow = {
      id: '1',
      userId: 'u',
      provider: 'WHOOP',
      accessTokenEnc: encryptWithKey('access', OLD_KEY),
      refreshTokenEnc: encryptWithKey('refresh', STRANGER_KEY),
    };
    expect(planRow(r, OLD_KEY, NEW_KEY)).toEqual({
      outcome: 'undecryptable',
      detail: 'refreshTokenEnc opens under neither key',
    });
  });

  it('names both fields when neither opens', () => {
    const r = row('1', STRANGER_KEY, 'a', 'r');
    expect(planRow(r, OLD_KEY, NEW_KEY)).toEqual({
      outcome: 'undecryptable',
      detail: 'accessTokenEnc, refreshTokenEnc opens under neither key',
    });
  });
});

describe('reencryptIntegrationTokens', () => {
  it('refuses identical keys', async () => {
    const { store } = fakeStore([]);
    await expect(
      reencryptIntegrationTokens({ store, oldKey: OLD_KEY, newKey: OLD_KEY })
    ).rejects.toThrow(/identical/);
  });

  it('dry run classifies every row and writes nothing', async () => {
    const rows = [
      row('a', OLD_KEY, 'acc-a', 'ref-a'),
      row('b', NEW_KEY, 'acc-b', 'ref-b'),
      { id: 'c', userId: 'user-c', provider: 'GARMIN', accessTokenEnc: '', refreshTokenEnc: null },
      row('d', STRANGER_KEY, 'acc-d', null),
    ];
    const { store, rows: stored, calls } = fakeStore(rows);
    const before = JSON.stringify([...stored.values()]);
    const seen: string[] = [];

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      onRow: (r) => seen.push(`${r.id}:${r.outcome}`),
    });

    expect(summary.execute).toBe(false);
    expect(summary.scanned).toBe(4);
    expect(summary.counts).toEqual({
      reencrypted: 1,
      'already-rotated': 1,
      revoked: 1,
      undecryptable: 1,
      conflict: 0,
      failed: 0,
    });
    expect(seen).toEqual(['a:reencrypted', 'b:already-rotated', 'c:revoked', 'd:undecryptable']);
    expect(calls.updateMany).toBe(0);
    expect(JSON.stringify([...stored.values()])).toBe(before);
  });

  it('execute re-encrypts old-key rows so they open under the new key only', async () => {
    const { store, rows: stored } = fakeStore([
      row('a', OLD_KEY, 'acc-a', 'ref-a'),
      row('b', OLD_KEY, 'acc-b', null, 'SUUNTO'),
      row('c', NEW_KEY, 'acc-c', 'ref-c'),
    ]);

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
    });

    expect(summary.execute).toBe(true);
    expect(summary.counts.reencrypted).toBe(2);
    expect(summary.counts['already-rotated']).toBe(1);
    for (const r of stored.values()) {
      expect(decryptWithKey(r.accessTokenEnc, NEW_KEY)).toBe(`acc-${r.id}`);
      expect(() => decryptWithKey(r.accessTokenEnc, OLD_KEY)).toThrow();
    }
    expect(decryptWithKey(stored.get('a')!.refreshTokenEnc as string, NEW_KEY)).toBe('ref-a');
    expect(stored.get('b')!.refreshTokenEnc).toBeNull();
  });

  it('is idempotent: a second run reports everything already rotated', async () => {
    const { store } = fakeStore([row('a', OLD_KEY, 'x', 'y'), row('b', OLD_KEY, 'x', 'y')]);
    const args = { store, oldKey: OLD_KEY, newKey: NEW_KEY, execute: true };

    await reencryptIntegrationTokens(args);
    const second = await reencryptIntegrationTokens(args);

    expect(second.counts.reencrypted).toBe(0);
    expect(second.counts['already-rotated']).toBe(2);
  });

  it('pages through rows larger than the batch size exactly once each', async () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      row(String(i).padStart(3, '0'), OLD_KEY, `acc-${i}`, null)
    );
    const { store, calls } = fakeStore(many);

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
      batchSize: 5,
    });

    expect(summary.scanned).toBe(23);
    expect(summary.counts.reencrypted).toBe(23);
    expect(new Set(summary.rows.map((r) => r.id)).size).toBe(23);
    // 4 full pages, one of 3, then an empty page to terminate
    expect(calls.findMany).toBe(6);
  });

  it('does not overwrite tokens the running API refreshed mid-rotation', async () => {
    const { store, rows: stored, calls } = fakeStore([row('a', OLD_KEY, 'stale', 'stale-r')], {
      onBeforeUpdate(id, attempt) {
        // The API refreshes the token (still under the old key, since it has
        // not been redeployed yet) between our read and our write.
        if (attempt === 1) {
          const r = stored.get(id)!;
          r.accessTokenEnc = encryptWithKey('fresh', OLD_KEY);
          r.refreshTokenEnc = encryptWithKey('fresh-r', OLD_KEY);
        }
      },
    });

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
    });

    expect(summary.counts.reencrypted).toBe(1);
    expect(summary.counts.conflict).toBe(0);
    expect(calls.updateMany).toBe(2);
    expect(calls.findUnique).toBe(1);
    // The refreshed value won, re-encrypted under the new key.
    expect(decryptWithKey(stored.get('a')!.accessTokenEnc, NEW_KEY)).toBe('fresh');
    expect(decryptWithKey(stored.get('a')!.refreshTokenEnc as string, NEW_KEY)).toBe('fresh-r');
  });

  it('gives up on a row that keeps changing and reports a conflict', async () => {
    const { store, rows: stored } = fakeStore([row('a', OLD_KEY, 'v0', null)], {
      onBeforeUpdate(id, attempt) {
        stored.get(id)!.accessTokenEnc = encryptWithKey(`v${attempt}`, OLD_KEY);
      },
    });

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
      maxAttempts: 2,
    });

    expect(summary.counts.conflict).toBe(1);
    expect(summary.rows[0].detail).toMatch(/re-run/);
    // Left under the old key, untouched by us.
    expect(decryptWithKey(stored.get('a')!.accessTokenEnc, OLD_KEY)).toBe('v2');
  });

  it('reports a row deleted during rotation as a conflict, not a failure', async () => {
    const { store, rows: stored } = fakeStore([row('a', OLD_KEY, 'v', null)], {
      onBeforeUpdate(id) {
        stored.delete(id);
      },
    });

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
    });

    expect(summary.counts.conflict).toBe(1);
    expect(summary.rows[0].detail).toMatch(/deleted/);
  });

  it('records a database error as failed and continues with other rows', async () => {
    const { store, rows: stored } = fakeStore([
      row('a', OLD_KEY, 'v', null),
      row('b', OLD_KEY, 'v', null),
    ]);
    const realUpdate = store.userIntegration.updateMany.bind(store.userIntegration);
    store.userIntegration.updateMany = async (args) => {
      if (args.where.id === 'a') throw new Error('connection reset');
      return realUpdate(args);
    };

    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
    });

    expect(summary.counts.failed).toBe(1);
    expect(summary.counts.reencrypted).toBe(1);
    expect(summary.rows.find((r) => r.id === 'a')?.detail).toBe('connection reset');
    expect(decryptWithKey(stored.get('b')!.accessTokenEnc, NEW_KEY)).toBe('v');
  });

  it('never puts token material in the report', async () => {
    const { store } = fakeStore([row('a', OLD_KEY, 'ACCESS-PLAINTEXT', 'REFRESH-PLAINTEXT')]);
    const summary = await reencryptIntegrationTokens({
      store,
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
    });
    const text = JSON.stringify(summary);
    expect(text).not.toContain('PLAINTEXT');
    expect(text).not.toContain('Enc');
  });
});
