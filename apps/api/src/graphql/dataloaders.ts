import DataLoader from 'dataloader';
import { prisma } from '../lib/prisma';
import type { ServiceLog, RideWeather } from '@prisma/client';

/**
 * Batch loads service logs for multiple components in a single query.
 * Solves the N+1 query problem when fetching serviceLogs for many components.
 */
async function batchServiceLogsByComponentId(
  componentIds: readonly string[]
): Promise<ServiceLog[][]> {
  // Single query to fetch all service logs for all component IDs
  const serviceLogs = await prisma.serviceLog.findMany({
    where: { componentId: { in: [...componentIds] } },
    orderBy: { performedAt: 'desc' },
  });

  // Group service logs by componentId
  const serviceLogsByComponentId = new Map<string, ServiceLog[]>();
  for (const log of serviceLogs) {
    const existing = serviceLogsByComponentId.get(log.componentId) || [];
    existing.push(log);
    serviceLogsByComponentId.set(log.componentId, existing);
  }

  // Return results in the same order as input keys (DataLoader requirement)
  return componentIds.map((id) => serviceLogsByComponentId.get(id) || []);
}

/**
 * Batch loads only the single most recent ServiceLog per component.
 *
 * Used by Component.latestServiceLog so pages that only show "last serviced"
 * metadata don't pay the full-history payload cost. Uses Postgres DISTINCT
 * ON for a one-query fan-out — cheaper than N separate findFirst calls and
 * cheaper than fetching every row and picking the first.
 */
async function batchLatestServiceLogByComponentId(
  componentIds: readonly string[]
): Promise<(ServiceLog | null)[]> {
  if (componentIds.length === 0) return [];
  const rows = await prisma.$queryRaw<ServiceLog[]>`
    SELECT DISTINCT ON ("componentId") *
    FROM "ServiceLog"
    WHERE "componentId" = ANY(${[...componentIds]}::text[])
    ORDER BY "componentId", "performedAt" DESC, "createdAt" DESC
  `;
  const byComponent = new Map<string, ServiceLog>();
  for (const row of rows) byComponent.set(row.componentId, row);
  return componentIds.map((id) => byComponent.get(id) ?? null);
}

/**
 * Batch loads RideWeather rows for many rides in one query.
 * Solves N+1 when Ride.weather is resolved across a rides list.
 */
async function batchWeatherByRideId(
  rideIds: readonly string[]
): Promise<(RideWeather | null)[]> {
  const rows = await prisma.rideWeather.findMany({
    where: { rideId: { in: [...rideIds] } },
  });
  const byRide = new Map<string, RideWeather>();
  for (const row of rows) byRide.set(row.rideId, row);
  return rideIds.map((id) => byRide.get(id) ?? null);
}

/**
 * Creates fresh DataLoader instances for a single request.
 * DataLoaders cache within a request, so create new instances per request
 * to avoid data leakage between users/requests.
 */
export function createDataLoaders() {
  return {
    serviceLogsByComponentId: new DataLoader<string, ServiceLog[]>(
      batchServiceLogsByComponentId
    ),
    latestServiceLogByComponentId: new DataLoader<string, ServiceLog | null>(
      batchLatestServiceLogByComponentId
    ),
    weatherByRideId: new DataLoader<string, RideWeather | null>(
      batchWeatherByRideId
    ),
  };
}

export type DataLoaders = ReturnType<typeof createDataLoaders>;
