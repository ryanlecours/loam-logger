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
    weatherByRideId: new DataLoader<string, RideWeather | null>(
      batchWeatherByRideId
    ),
  };
}

export type DataLoaders = ReturnType<typeof createDataLoaders>;
