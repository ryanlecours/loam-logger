export type ComponentLite = {
  id: string;
  type: string;
  location: string;
  brand: string;
  model: string;
};

export type HistoryRide = {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  averageHr?: number | null;
  rideType: string;
  trailSystem?: string | null;
  location?: string | null;
};

export type HistoryServiceEvent = {
  id: string;
  performedAt: string;
  notes?: string | null;
  hoursAtService: number;
  component: ComponentLite;
};

export type HistoryInstallEvent = {
  id: string;
  eventType: 'INSTALLED' | 'REMOVED';
  occurredAt: string;
  component: ComponentLite;
};

export type HistoryBike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
  year?: number | null;
};

export type HistoryTotals = {
  rideCount: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  totalElevationGainMeters: number;
  serviceEventCount: number;
  installEventCount: number;
};

export type TimelineItem =
  | { kind: 'ride'; date: Date; ride: HistoryRide }
  | { kind: 'service'; date: Date; service: HistoryServiceEvent }
  | { kind: 'install'; date: Date; install: HistoryInstallEvent };

export type Timeframe = 'all' | '1y' | '90d' | '30d';

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  all: 'All time',
  '1y': 'Past year',
  '90d': 'Past 90 days',
  '30d': 'Past 30 days',
};

export function computeTimeframeRange(
  tf: Timeframe,
  now = new Date()
): { startDate?: string; endDate?: string } {
  if (tf === 'all') return {};
  const end = now;
  const start = new Date(end);
  if (tf === '30d') start.setDate(start.getDate() - 30);
  else if (tf === '90d') start.setDate(start.getDate() - 90);
  else if (tf === '1y') start.setFullYear(start.getFullYear() - 1);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export function mergeAndGroupByYear(params: {
  rides: HistoryRide[];
  serviceEvents: HistoryServiceEvent[];
  installs: HistoryInstallEvent[];
  showRides: boolean;
  showService: boolean;
}): Array<{ year: number; items: TimelineItem[] }> {
  const { rides, serviceEvents, installs, showRides, showService } = params;
  const items: TimelineItem[] = [];
  if (showRides) {
    for (const ride of rides) {
      items.push({ kind: 'ride', date: new Date(ride.startTime), ride });
    }
  }
  if (showService) {
    for (const service of serviceEvents) {
      items.push({ kind: 'service', date: new Date(service.performedAt), service });
    }
    for (const install of installs) {
      items.push({ kind: 'install', date: new Date(install.occurredAt), install });
    }
  }
  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  const byYear = new Map<number, TimelineItem[]>();
  for (const item of items) {
    const year = item.date.getFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(item);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({ year, items }));
}

export function bikeName(bike: HistoryBike): string {
  return bike.nickname || `${bike.manufacturer} ${bike.model}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
