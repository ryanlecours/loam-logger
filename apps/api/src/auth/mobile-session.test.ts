jest.mock('../lib/prisma', () => ({
  prisma: {
    mobileSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
} from './mobile-session';

const mockCreate = prisma.mobileSession.create as jest.Mock;
const mockFindUnique = prisma.mobileSession.findUnique as jest.Mock;
const mockUpdate = prisma.mobileSession.update as jest.Mock;
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
  it('rotates on the current jti: new jti, presented becomes previous, expiry slides', async () => {
    mockFindUnique.mockResolvedValue(liveSession());
    mockUpdate.mockResolvedValue({});

    const before = Date.now();
    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: true, jti: expect.any(String) });
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.currentJti).not.toBe('jti-current');
    expect(data.previousJti).toBe('jti-current');
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + MOBILE_REFRESH_TTL_MS);
  });

  it('honors the previous jti inside the grace window (lost-response retry)', async () => {
    mockFindUnique.mockResolvedValue(
      liveSession({ rotatedAt: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS / 2) }),
    );
    mockUpdate.mockResolvedValue({});

    const result = await rotateMobileSession('sid-1', 'jti-previous');

    expect(result.ok).toBe(true);
  });

  it('revokes the session when the previous jti is replayed after the grace window', async () => {
    mockFindUnique.mockResolvedValue(
      liveSession({ rotatedAt: new Date(Date.now() - REFRESH_ROTATION_GRACE_MS - 1_000) }),
    );
    mockUpdate.mockResolvedValue({});

    const result = await rotateMobileSession('sid-1', 'jti-previous');

    expect(result).toEqual({ ok: false, reason: 'reuse-detected' });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'sid-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes the session when the jti matches nothing in the chain', async () => {
    mockFindUnique.mockResolvedValue(liveSession());
    mockUpdate.mockResolvedValue({});

    const result = await rotateMobileSession('sid-1', 'jti-from-another-era');

    expect(result).toEqual({ ok: false, reason: 'reuse-detected' });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'sid-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a revoked session without touching it', async () => {
    mockFindUnique.mockResolvedValue(liveSession({ revokedAt: new Date() }));

    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: false, reason: 'revoked' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    mockFindUnique.mockResolvedValue(
      liveSession({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    const result = await rotateMobileSession('sid-1', 'jti-current');

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an unknown session id', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await rotateMobileSession('sid-missing', 'jti-current');

    expect(result).toEqual({ ok: false, reason: 'not-found' });
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
