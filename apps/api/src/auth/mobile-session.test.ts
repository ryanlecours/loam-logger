jest.mock('../lib/prisma', () => ({
  prisma: {
    mobileSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma';
import {
  MOBILE_REFRESH_TTL_MS,
  REFRESH_ROTATION_GRACE_MS,
  createMobileSession,
  rotateMobileSession,
  revokeMobileSession,
  upgradeLegacySession,
  hashLegacyToken,
  deleteDefunctMobileSessions,
} from './mobile-session';

const mockCreate = prisma.mobileSession.create as jest.Mock;
const mockFindUnique = prisma.mobileSession.findUnique as jest.Mock;
const mockUpdateMany = prisma.mobileSession.updateMany as jest.Mock;

function liveSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sid-1',
    userId: 'user-1',
    currentJti: 'jti-current',
    previousJti: 'jti-previous',
    rotatedAt: new Date(Date.now() - 5_000),
    createdAt: new Date(Date.now() - 100_000),
    lastUsedAt: new Date(Date.now() - 5_000),
    expiresAt: new Date(Date.now() + MOBILE_REFRESH_TTL_MS),
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createMobileSession', () => {
  it('creates a row with a sliding expiry and returns its sid and jti', async () => {
    mockCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'sid-new', ...data }),
    );

    const before = Date.now();
    const result = await createMobileSession('user-1');

    expect(result.sid).toBe('sid-new');
    expect(result.jti).toEqual(expect.any(String));
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.userId).toBe('user-1');
    expect(data.currentJti).toBe(result.jti);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + MOBILE_REFRESH_TTL_MS);
  });
});

describe('rotateMobileSession', () => {
  it('rotates via a single conditional write on the presented jti (no read-then-write race)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const before = Date.now();
    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: true, jti: expect.any(String) });
    const call = mockUpdateMany.mock.calls[0][0];
    // The atomicity lives in this where clause: the rotation only lands if
    // the presented jti is still current at write time.
    expect(call.where).toEqual({
      id: 'sid-1',
      currentJti: 'jti-current',
      revokedAt: null,
      expiresAt: { gt: expect.any(Date) },
    });
    expect(call.data.currentJti).not.toBe('jti-current');
    expect(call.data.previousJti).toBe('jti-current');
    expect(call.data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + MOBILE_REFRESH_TTL_MS);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('hands a race loser the winning rotation instead of rotating again', async () => {
    // Two refreshes raced with the same jti; the winner already rotated
    // currentJti to 'jti-winner' with previousJti = the presented one.
    mockUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue(
      liveSession({
        currentJti: 'jti-winner',
        previousJti: 'jti-raced',
        rotatedAt: new Date(Date.now() - 1_000),
      }),
    );

    const result = await rotateMobileSession('sid-1', 'jti-raced');

    // Same jti the winner received: whichever response the device stores
    // last, it holds a live token.
    expect(result).toEqual({ ok: true, jti: 'jti-winner' });
    // The follow-up write slides expiry only; rotating here would clobber
    // the winner's jti and orphan the other device response.
    const slide = mockUpdateMany.mock.calls[1][0];
    expect(slide.data.currentJti).toBeUndefined();
    expect(slide.data.expiresAt).toEqual(expect.any(Date));
  });

  it('re-issues the current jti defensively if the conditional write missed while still current', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue(liveSession());

    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: true, jti: 'jti-current' });
  });

  it('revokes the session when the previous jti is replayed after the grace window', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue(
      liveSession({ rotatedAt: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS - 1_000) }),
    );

    const result = await rotateMobileSession('sid-1', 'jti-previous');

    expect(result).toEqual({ ok: false, reason: 'reuse-detected', detail: 'spent-previous' });
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'sid-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes the session when the jti matches nothing in the chain', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue(liveSession());

    const result = await rotateMobileSession('sid-1', 'jti-from-another-era');

    expect(result).toEqual({ ok: false, reason: 'reuse-detected', detail: 'unknown-jti' });
    expect(mockUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'sid-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a revoked session without touching it', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue(liveSession({ revokedAt: new Date() }));

    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: false, reason: 'revoked' });
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired session', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue(
      liveSession({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown session id', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindUnique.mockResolvedValue(null);

    const result = await rotateMobileSession('sid-missing', 'jti-current');

    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('upgradeLegacySession', () => {
  const HASH = hashLegacyToken('legacy-token-bytes');

  function upgradedSession(overrides: Record<string, unknown> = {}) {
    return liveSession({
      previousJti: null,
      legacyTokenHash: HASH,
      rotatedAt: new Date(Date.now() - 5_000),
      ...overrides,
    });
  }

  it('claims an unclaimed legacy token by creating a session bound to its hash', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'sid-new', ...data }));

    const result = await upgradeLegacySession('user-1', HASH);

    expect(result).toEqual({ ok: true, sid: 'sid-new', jti: expect.any(String) });
    expect(mockCreate.mock.calls[0][0].data.legacyTokenHash).toBe(HASH);
  });

  it('re-issues the session pair on a lost-response retry (never rotated, within grace)', async () => {
    mockFindUnique.mockResolvedValue(upgradedSession());

    const result = await upgradeLegacySession('user-1', HASH);

    expect(result).toEqual({ ok: true, sid: 'sid-1', jti: 'jti-current' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('revokes the claimed session when the legacy token is replayed after the device rotated', async () => {
    mockFindUnique.mockResolvedValue(upgradedSession({ previousJti: 'jti-rotated-once' }));

    const result = await upgradeLegacySession('user-1', HASH);

    expect(result).toEqual({ ok: false, reason: 'reuse-detected' });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sid-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('revokes the claimed session when replayed outside the grace window', async () => {
    mockFindUnique.mockResolvedValue(
      upgradedSession({ rotatedAt: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS - 1_000) }),
    );

    const result = await upgradeLegacySession('user-1', HASH);

    expect(result).toEqual({ ok: false, reason: 'reuse-detected' });
  });

  it('refuses an already-revoked claim without minting anything', async () => {
    mockFindUnique.mockResolvedValue(upgradedSession({ revokedAt: new Date() }));

    const result = await upgradeLegacySession('user-1', HASH);

    expect(result).toEqual({ ok: false, reason: 'reuse-detected' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('resolves a concurrent-upgrade race against the winning row', async () => {
    // Both racers see the token unclaimed; the loser's create hits the
    // unique index and must settle against the winner's session.
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(upgradedSession({ currentJti: 'jti-winner' }));
    mockCreate.mockRejectedValue(new Error('Unique constraint failed on legacyTokenHash'));

    const result = await upgradeLegacySession('user-1', HASH);

    expect(result).toEqual({ ok: true, sid: 'sid-1', jti: 'jti-winner' });
  });
});

describe('deleteDefunctMobileSessions', () => {
  it('deletes only rows revoked or expired before the retention cutoff', async () => {
    const mockDeleteMany = prisma.mobileSession.deleteMany as jest.Mock;
    mockDeleteMany.mockResolvedValue({ count: 7 });

    const before = Date.now();
    const deleted = await deleteDefunctMobileSessions(30);

    expect(deleted).toBe(7);
    const where = mockDeleteMany.mock.calls[0][0].where;
    const cutoffMs = 30 * 24 * 60 * 60 * 1000;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].revokedAt.lt.getTime()).toBeLessThanOrEqual(before - cutoffMs + 1_000);
    expect(where.OR[1].expiresAt.lt.getTime()).toBeLessThanOrEqual(before - cutoffMs + 1_000);
  });
});

describe('hashLegacyToken', () => {
  it('is deterministic and shaped like sha256 hex', () => {
    expect(hashLegacyToken('abc')).toBe(hashLegacyToken('abc'));
    expect(hashLegacyToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLegacyToken('abc')).not.toBe(hashLegacyToken('abd'));
  });
});

describe('revokeMobileSession', () => {
  it('scopes the revocation to the owning user and unrevoked rows', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await revokeMobileSession('sid-1', 'user-1');

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'sid-1', userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
