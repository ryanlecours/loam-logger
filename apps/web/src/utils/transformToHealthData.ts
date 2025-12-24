import { getHealthStatus } from './getHealthStatus';

/** Component summary from GraphQL BIKES query */
export interface ComponentSummary {
  id: string;
  type?: string;
  brand?: string | null;
  model?: string | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
  updatedAt?: string | null;
}

/** Bike summary from GraphQL BIKES query */
export interface BikeSummary {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
  fork?: ComponentSummary | null;
  shock?: ComponentSummary | null;
  pivotBearings?: ComponentSummary | null;
  components: ComponentSummary[];
}

/** Processed component health data for display */
export interface ComponentHealth {
  id: string;
  label: string;
  brand: string;
  model: string;
  hoursUsed: number;
  status: 'ok' | 'warning' | 'danger';
  lastServiceDate: Date | null;
}

/** Processed bike health data for display */
export interface BikeHealth {
  id: string;
  name: string;
  components: ComponentHealth[];
  criticalCount: number;
  warningCount: number;
  isHealthy: boolean;
}

const COMPONENT_LABELS: Record<string, string> = {
  FORK: 'Fork',
  SHOCK: 'Shock',
  PIVOT_BEARINGS: 'Pivot Bearings',
  DROPPER: 'Dropper Post',
  WHEELS: 'Wheel Bearings',
  DRIVETRAIN: 'Drivetrain',
};

function parseLastServiceDate(updatedAt?: string | null): Date | null {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  return isNaN(date.getTime()) ? null : date;
}

function transformComponent(
  comp: ComponentSummary | null | undefined,
  type: string
): ComponentHealth | null {
  if (!comp?.id) return null;

  const hours = comp.hoursUsed ?? 0;
  return {
    id: comp.id,
    label: COMPONENT_LABELS[type] ?? type,
    brand: comp.brand ?? 'Stock',
    model: comp.model ?? 'Stock',
    hoursUsed: hours,
    status: getHealthStatus(hours),
    lastServiceDate: parseLastServiceDate(comp.updatedAt),
  };
}

/**
 * Transforms raw bike data from GraphQL into health-focused format.
 * Aggregates component health counts per bike for quick status display.
 */
export function transformToHealthData(bikes: BikeSummary[]): BikeHealth[] {
  return bikes.map((bike) => {
    const name =
      bike.nickname?.trim() ||
      `${bike.manufacturer} ${bike.model}`.trim() ||
      'Bike';

    // Build components list from fork, shock, pivotBearings, and generic components
    const components: ComponentHealth[] = [
      transformComponent(bike.fork, 'FORK'),
      transformComponent(bike.shock, 'SHOCK'),
      transformComponent(bike.pivotBearings, 'PIVOT_BEARINGS'),
      ...bike.components
        .filter((c) => !['FORK', 'SHOCK', 'PIVOT_BEARINGS'].includes(c.type ?? ''))
        .map((c) => transformComponent(c, c.type ?? 'UNKNOWN')),
    ].filter((c): c is ComponentHealth => c !== null);

    const criticalCount = components.filter((c) => c.status === 'danger').length;
    const warningCount = components.filter((c) => c.status === 'warning').length;
    const isHealthy = criticalCount === 0 && warningCount === 0;

    return {
      id: bike.id,
      name,
      components,
      criticalCount,
      warningCount,
      isHealthy,
    };
  });
}
