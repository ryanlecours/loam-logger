const mockPrisma = {
  userIntegration: { findMany: jest.fn() },
  oauthToken: { findMany: jest.fn() },
  backfillRequest: { findFirst: jest.fn() },
  importSession: { findFirst: jest.fn() },
  ride: { count: jest.fn() },
};
jest.mock('./prisma', () => ({ prisma: mockPrisma }));

import { resolveRideSource, getConnectedRideProviders, WHOOP_SYNC_GRACE_MS } from './ride-source';

const userId = 'user-123';
const NOW = new Date('2026-10-28T12:00:00Z');
const T0 = new Date('2026-10-28T11:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.userIntegration.findMany.mockResolvedValue([]);
  mockPrisma.oauthToken.findMany.mockResolvedValue([]);
  mockPrisma.backfillRequest.findFirst.mockResolvedValue(null);
  mockPrisma.importSession.findFirst.mockResolvedValue(null);
  mockPrisma.ride.count.mockResolvedValue(0);
});

describe('getConnectedRideProviders', () => {
  it('reads integrations the status routes would call connected, in client order', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([
      { provider: 'SUUNTO', connectedAt: T0 },
      { provider: 'STRAVA', connectedAt: T0 },
    ]);

    const result = await getConnectedRideProviders(userId);

    expect(result.map((c) => c.provider)).toEqual(['strava', 'suunto']);
    expect(mockPrisma.userIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, revokedAt: null } })
    );
  });

  // The status routes fall back to the token row when the integration is
  // revoked or missing, so a leftover token still reads as connected there.
  // This matches them on purpose; Settings and the dashboard must agree.
  it('treats a leftover OauthToken as connected even after the integration was revoked', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([]);
    mockPrisma.oauthToken.findMany.mockResolvedValue([{ provider: 'strava', createdAt: T0 }]);

    const result = await getConnectedRideProviders(userId);

    expect(result).toEqual([{ provider: 'strava', connectedAt: T0 }]);
  });

  // WHOOP never writes a UserIntegration row; its token row is the connection.
  it('counts an OauthToken row as connected, without duplicating an integration', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'STRAVA', connectedAt: T0 }]);
    mockPrisma.oauthToken.findMany.mockResolvedValue([
      { provider: 'whoop', createdAt: T0 },
      { provider: 'strava', createdAt: new Date('2020-01-01T00:00:00Z') },
    ]);

    const result = await getConnectedRideProviders(userId);

    expect(result).toEqual([
      { provider: 'strava', connectedAt: T0 },
      { provider: 'whoop', connectedAt: T0 },
    ]);
  });
});

describe('resolveRideSource', () => {
  it('reports nothing connected and no import when the rider never connected', async () => {
    mockPrisma.ride.count.mockResolvedValue(0);

    const result = await resolveRideSource(userId, NOW);

    expect(result).toEqual({ connectedProviders: [], rideCount: 0, autoImport: null });
    expect(mockPrisma.backfillRequest.findFirst).not.toHaveBeenCalled();
  });

  it('counts every ride on the account, whatever its source', async () => {
    mockPrisma.ride.count.mockResolvedValue(7);

    const result = await resolveRideSource(userId, NOW);

    expect(result.rideCount).toBe(7);
    expect(mockPrisma.ride.count).toHaveBeenCalledWith({ where: { userId } });
  });

  it('reports a queued Strava import as pending with nothing counted yet', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'STRAVA', connectedAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'strava',
      status: 'pending',
      ridesFound: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: T0,
      completedAt: null,
    });

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toEqual({
      provider: 'strava',
      status: 'PENDING',
      ridesFound: null,
      lookbackDays: 365,
      startedAt: T0.toISOString(),
      completedAt: null,
    });
    // Only the automatic import's window counts; a Settings-driven year does not.
    expect(mockPrisma.backfillRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, year: '365d', provider: { in: ['strava'] } } })
    );
  });

  it('reads Garmin progress from the running import session', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'GARMIN', connectedAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'garmin',
      status: 'in_progress',
      ridesFound: null,
      createdAt: T0,
      updatedAt: T0,
      completedAt: null,
    });
    mockPrisma.importSession.findFirst.mockResolvedValue({ _count: { rides: 12 } });

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toMatchObject({ provider: 'garmin', status: 'RUNNING', ridesFound: 12 });
    expect(mockPrisma.importSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId, provider: 'garmin', status: 'running' } })
    );
  });

  // Strava imports complete inside one job; there is no session to count.
  it('does not look for a session while a Strava import runs', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'STRAVA', connectedAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'strava',
      status: 'in_progress',
      ridesFound: null,
      createdAt: T0,
      updatedAt: T0,
      completedAt: null,
    });

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toMatchObject({ status: 'RUNNING', ridesFound: null });
    expect(mockPrisma.importSession.findFirst).not.toHaveBeenCalled();
  });

  it('reports a finished import with the rides it found', async () => {
    const done = new Date('2026-10-28T11:20:00Z');
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'STRAVA', connectedAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'strava',
      status: 'completed',
      ridesFound: 0,
      createdAt: T0,
      updatedAt: done,
      completedAt: done,
    });

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toEqual({
      provider: 'strava',
      status: 'COMPLETED',
      ridesFound: 0,
      lookbackDays: 365,
      startedAt: T0.toISOString(),
      completedAt: done.toISOString(),
    });
  });

  // A completed row from before ridesFound was recorded has nothing to count.
  it('reports a finished import with no recorded count as null, not zero', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'GARMIN', connectedAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'garmin',
      status: 'completed',
      ridesFound: null,
      createdAt: T0,
      updatedAt: T0,
      completedAt: T0,
    });

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toMatchObject({ status: 'COMPLETED', ridesFound: null });
    expect(mockPrisma.importSession.findFirst).not.toHaveBeenCalled();
  });

  it('reports a failed import as failed', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'SUUNTO', connectedAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'suunto',
      status: 'failed',
      ridesFound: null,
      createdAt: T0,
      updatedAt: T0,
      completedAt: null,
    });

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toMatchObject({ provider: 'suunto', status: 'FAILED', ridesFound: null });
  });

  // WHOOP's connect-time sync is a queue job with no row to read, so the
  // connect time stands in: running for a grace period, then settled.
  it('treats a fresh WHOOP connect as a running 30-day import', async () => {
    mockPrisma.oauthToken.findMany.mockResolvedValue([{ provider: 'whoop', createdAt: new Date(NOW.getTime() - 60_000) }]);

    const result = await resolveRideSource(userId, NOW);

    expect(result.connectedProviders).toEqual(['whoop']);
    expect(result.autoImport).toMatchObject({
      provider: 'whoop',
      status: 'RUNNING',
      ridesFound: null,
      lookbackDays: 30,
      completedAt: null,
    });
  });

  it('treats an older WHOOP connect as settled', async () => {
    const connectedAt = new Date(NOW.getTime() - WHOOP_SYNC_GRACE_MS - 1);
    mockPrisma.oauthToken.findMany.mockResolvedValue([{ provider: 'whoop', createdAt: connectedAt }]);

    const result = await resolveRideSource(userId, NOW);

    expect(result.autoImport).toMatchObject({ provider: 'whoop', status: 'COMPLETED', lookbackDays: 30 });
    expect(result.autoImport?.completedAt).toBe(new Date(connectedAt.getTime() + WHOOP_SYNC_GRACE_MS).toISOString());
  });

  // A tracked import for any connected provider beats the WHOOP stand-in.
  it('prefers a real request row over the WHOOP stand-in', async () => {
    mockPrisma.userIntegration.findMany.mockResolvedValue([{ provider: 'GARMIN', connectedAt: T0 }]);
    mockPrisma.oauthToken.findMany.mockResolvedValue([{ provider: 'whoop', createdAt: T0 }]);
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({
      provider: 'garmin',
      status: 'completed',
      ridesFound: 40,
      createdAt: T0,
      updatedAt: T0,
      completedAt: T0,
    });

    const result = await resolveRideSource(userId, NOW);

    expect(result.connectedProviders).toEqual(['garmin', 'whoop']);
    expect(result.autoImport).toMatchObject({ provider: 'garmin', ridesFound: 40 });
  });
});
