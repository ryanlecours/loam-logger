/**
 * Where a rider's hours come from.
 *
 * Both dashboards used to show a bike with no rides as "no rides yet" and
 * offer a Strava button, whether or not anything was connected. Neither could
 * tell "nothing connected" from "connected and the import is still running"
 * from "connected and the last year had no rides in it", and those three want
 * three different cards. This module answers that question once, for the
 * `User.rideSource` field, from three facts: which providers are connected,
 * the newest automatic import (the `365d` BackfillRequest that
 * lib/auto-import.ts queues from every OAuth callback), and whether any ride
 * at all has landed.
 *
 * "Connected" means what the status routes report: a UserIntegration row that
 * is not revoked, or, for WHOOP and the providers still carrying legacy rows,
 * an OauthToken row. Settings on both clients read those routes, so the
 * dashboard and Settings agree on what is connected.
 */

import type { BackfillStatus } from '@prisma/client';
import { prisma } from './prisma';
import { AUTO_IMPORT_PERIOD } from './auto-import';
import type { RideProvider } from './posthog';

export type AutoImportStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface AutoImport {
  provider: RideProvider;
  status: AutoImportStatus;
  /**
   * Rides the import has brought in so far. Garmin and Suunto deliver rides
   * through webhooks tagged with an ImportSession, so this counts up while the
   * import runs. Strava imports finish inside one job and report the figure
   * only at the end. Null when nothing can be counted yet.
   */
  ridesFound: number | null;
  /** How far back the import looks, in days. */
  lookbackDays: number;
  startedAt: string;
  completedAt: string | null;
}

export interface RideSource {
  connectedProviders: RideProvider[];
  rideCount: number;
  autoImport: AutoImport | null;
}

/** WHOOP's connect-time sync covers the last 30 days; there is no history import. */
const WHOOP_LOOKBACK_DAYS = 30;
const AUTO_IMPORT_LOOKBACK_DAYS = 365;

/**
 * WHOOP's connect-time sync is a queue job with no row behind it, so there is
 * nothing to read its progress from. It normally finishes within seconds; this
 * is how long after a connect the dashboard keeps saying "importing" before
 * treating the window as settled.
 */
export const WHOOP_SYNC_GRACE_MS = 10 * 60 * 1000;

const RIDE_PROVIDERS: RideProvider[] = ['strava', 'garmin', 'whoop', 'suunto'];

function isRideProvider(value: string): value is RideProvider {
  return (RIDE_PROVIDERS as string[]).includes(value);
}

interface ConnectedProvider {
  provider: RideProvider;
  connectedAt: Date;
}

/**
 * Providers the rider is connected to, in the order the clients list them.
 * Mirrors the `/auth/<provider>/status` routes: UserIntegration first, with
 * OauthToken as the fallback those routes still honour.
 */
export async function getConnectedRideProviders(userId: string): Promise<ConnectedProvider[]> {
  const [integrations, tokens] = await Promise.all([
    prisma.userIntegration.findMany({
      where: { userId, revokedAt: null },
      select: { provider: true, connectedAt: true },
    }),
    prisma.oauthToken.findMany({
      where: { userId, provider: { in: RIDE_PROVIDERS } },
      select: { provider: true, createdAt: true },
    }),
  ]);

  const byProvider = new Map<RideProvider, Date>();
  for (const row of integrations) {
    const provider = row.provider.toLowerCase();
    if (isRideProvider(provider)) byProvider.set(provider, row.connectedAt);
  }
  for (const row of tokens) {
    const provider = String(row.provider);
    if (isRideProvider(provider) && !byProvider.has(provider)) byProvider.set(provider, row.createdAt);
  }

  return RIDE_PROVIDERS.filter((p) => byProvider.has(p)).map((provider) => ({
    provider,
    connectedAt: byProvider.get(provider) as Date,
  }));
}

// Keyed on the Prisma enum so adding a BackfillStatus fails to compile here
// rather than silently reporting the new state as something it is not.
const STATUS_MAP: Record<BackfillStatus, AutoImportStatus> = {
  pending: 'PENDING',
  in_progress: 'RUNNING',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

/**
 * The newest automatic import for a provider that is still connected. A row
 * left behind by a provider the rider has since disconnected says nothing
 * about where their hours come from now, so it is skipped.
 */
async function findAutoImport(
  userId: string,
  connected: ConnectedProvider[],
  now: Date
): Promise<AutoImport | null> {
  const providers = connected.map((c) => c.provider);
  if (providers.length === 0) return null;

  const request = await prisma.backfillRequest.findFirst({
    where: { userId, year: AUTO_IMPORT_PERIOD, provider: { in: providers } },
    orderBy: { updatedAt: 'desc' },
    select: {
      provider: true,
      status: true,
      ridesFound: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  if (request) {
    const provider = String(request.provider) as RideProvider;
    const status = STATUS_MAP[request.status];

    let ridesFound: number | null = request.status === 'completed' ? request.ridesFound : null;
    if (request.status === 'in_progress' && provider !== 'strava') {
      // Garmin and Suunto rides arrive by webhook, tagged with the session
      // the auto import opened, so the session's ride count is the progress.
      const session = await prisma.importSession.findFirst({
        where: { userId, provider: request.provider, status: 'running' },
        orderBy: { startedAt: 'desc' },
        select: { _count: { select: { rides: true } } },
      });
      ridesFound = session ? session._count.rides : null;
    }

    return {
      provider,
      status,
      ridesFound,
      lookbackDays: AUTO_IMPORT_LOOKBACK_DAYS,
      // The row is upserted on every connect and touched by the worker, so
      // while it is live updatedAt is the most recent sign of progress. Once
      // it has settled, createdAt is the only start time it still carries.
      startedAt: (status === 'COMPLETED' || status === 'FAILED'
        ? request.createdAt
        : request.updatedAt
      ).toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
    };
  }

  // WHOOP has no history import and no request row: its connect-time sync is
  // a queue job that covers the last 30 days. Report it as running for a
  // grace period after the connect, then as settled.
  const whoop = connected.find((c) => c.provider === 'whoop');
  if (whoop) {
    const running = now.getTime() - whoop.connectedAt.getTime() < WHOOP_SYNC_GRACE_MS;
    return {
      provider: 'whoop',
      status: running ? 'RUNNING' : 'COMPLETED',
      ridesFound: null,
      lookbackDays: WHOOP_LOOKBACK_DAYS,
      startedAt: whoop.connectedAt.toISOString(),
      completedAt: running ? null : new Date(whoop.connectedAt.getTime() + WHOOP_SYNC_GRACE_MS).toISOString(),
    };
  }

  return null;
}

export async function resolveRideSource(userId: string, now: Date = new Date()): Promise<RideSource> {
  const [connected, rideCount] = await Promise.all([
    getConnectedRideProviders(userId),
    prisma.ride.count({ where: { userId } }),
  ]);
  const autoImport = await findAutoImport(userId, connected, now);

  return {
    connectedProviders: connected.map((c) => c.provider),
    rideCount,
    autoImport,
  };
}
