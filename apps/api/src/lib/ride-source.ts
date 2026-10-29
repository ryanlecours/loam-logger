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
import { GARMIN_PERIOD_DAYS } from './garmin-backfill-periods';
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
/** Derived from the window auto-import queues, so the two cannot drift. */
const AUTO_IMPORT_LOOKBACK_DAYS: number = GARMIN_PERIOD_DAYS[AUTO_IMPORT_PERIOD];

/**
 * A request still pending or running whose row has not moved for this long is
 * reported as failed. The import-session checker's stale sweep marks such rows
 * failed after an hour, so this is a belt for when that sweep is not running:
 * without it a dead row would keep the dashboards saying "importing" and
 * polling until someone restarts the checker.
 */
export const STUCK_IMPORT_MS = 2 * 60 * 60 * 1000;

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

  // The where clause only admits connected ride providers, but the column is
  // the wider AuthProvider enum; keep the type honest rather than cast.
  const requestProvider = request ? String(request.provider) : null;
  if (request && requestProvider && isRideProvider(requestProvider)) {
    const provider = requestProvider;
    const live = request.status === 'pending' || request.status === 'in_progress';
    const stuck = live && now.getTime() - request.updatedAt.getTime() >= STUCK_IMPORT_MS;
    const status: AutoImportStatus = stuck ? 'FAILED' : STATUS_MAP[request.status];

    let ridesFound: number | null = request.status === 'completed' ? request.ridesFound : null;
    // The request row has no start column of its own: it is upserted on
    // every connect and the Garmin worker touches updatedAt per chunk, so
    // neither createdAt nor updatedAt is a steady "started". While a Garmin
    // or Suunto import runs, the session the auto import opened carries the
    // real start; otherwise updatedAt is the last moment the row moved
    // (queue time for pending, pickup for a Strava run, settlement after).
    let startedAt = request.updatedAt;
    if (request.status === 'in_progress' && !stuck && provider !== 'strava') {
      // Garmin and Suunto rides arrive by webhook, tagged with the session
      // the auto import opened, so the session's ride count is the progress.
      const session = await prisma.importSession.findFirst({
        where: { userId, provider: request.provider, status: 'running' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, _count: { select: { rides: true } } },
      });
      if (session) {
        ridesFound = session._count.rides;
        startedAt = session.startedAt;
      }
    }

    return {
      provider,
      status,
      ridesFound,
      lookbackDays: AUTO_IMPORT_LOOKBACK_DAYS,
      startedAt: startedAt.toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
    };
  }

  // WHOOP has no history import and no request row: its connect-time sync is
  // a queue job that covers the last 30 days. Report it as running for a
  // grace period after the connect, then as settled. Only reached when no
  // connected provider has a request row: on an account with Strava and
  // WHOOP, the field describes the Strava import, which is the one that can
  // bring in a year of rides and the one with progress to report.
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
  // The dashboards only read the import while the account has no rides; once
  // any ride exists they show the rides, so the extra reads are skipped.
  const autoImport = rideCount > 0 ? null : await findAutoImport(userId, connected, now);

  return {
    connectedProviders: connected.map((c) => c.provider),
    rideCount,
    autoImport,
  };
}
