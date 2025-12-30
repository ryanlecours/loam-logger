import DataLoader from 'dataloader';
import { prisma } from '../lib/prisma';
import type { ServiceLog } from '@prisma/client';

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
 * Creates fresh DataLoader instances for a single request.
 * DataLoaders cache within a request, so create new instances per request
 * to avoid data leakage between users/requests.
 */
export function createDataLoaders() {
  return {
    serviceLogsByComponentId: new DataLoader<string, ServiceLog[]>(
      batchServiceLogsByComponentId
    ),
  };
}

export type DataLoaders = ReturnType<typeof createDataLoaders>;
