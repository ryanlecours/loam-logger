import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import TimeframeSelector from './TimeframeSelector';
import StatsSummary from './StatsSummary';
import BikeUsageChart from './BikeUsageChart';
import type { Ride } from '../../models/Ride';
import type { RideStats, RideStatsByTimeframe, Timeframe } from '../../models/BikeTimeData';
import { RIDES } from '../../graphql/rides';
import { BIKES } from '../../graphql/bikes';

type BikeSummary = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

const TIMEFRAMES: Timeframe[] = ['1w', '1m', '3m', 'YTD'];
const MAX_RIDES_FOR_STATS = 100;
const UNASSIGNED_BIKE_LABEL = 'Unassigned Bike';
const EMPTY_STATS: RideStats = { distance: 0, elevation: 0, hours: 0, bikeTime: [] };

const DAYS = 24 * 60 * 60 * 1000;
const SECONDS_TO_HOURS = 1 / 3600;

const parseStartTime = (value: Ride['startTime']): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num < 1e12 ? num * 1000 : num;
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBikeName = (bike: BikeSummary): string => {
  const nickname = bike.nickname?.trim();
  const fallback = `${bike.manufacturer ?? ''} ${bike.model ?? ''}`.trim();
  return nickname || fallback || 'Bike';
};

const buildBikeNameMap = (bikes: BikeSummary[]): Map<string, string> => {
  const map = new Map<string, string>();
  bikes.forEach((bike) => map.set(bike.id, toBikeName(bike)));
  return map;
};

type MutableAggregate = {
  distance: number;
  elevation: number;
  hours: number;
  bikeHours: Map<string, number>;
};

const createAggregate = (): MutableAggregate => ({
  distance: 0,
  elevation: 0,
  hours: 0,
  bikeHours: new Map<string, number>(),
});

const computeRideStats = (
  rides: Ride[],
  bikeNameMap: Map<string, string>
): RideStatsByTimeframe => {
  const now = Date.now();
  const thresholds: Record<Timeframe, number> = {
    '1w': now - 7 * DAYS,
    '1m': now - 30 * DAYS,
    '3m': now - 90 * DAYS,
    'YTD': new Date(new Date().getFullYear(), 0, 1).getTime(),
  };

  const aggregates: Record<Timeframe, MutableAggregate> = {
    '1w': createAggregate(),
    '1m': createAggregate(),
    '3m': createAggregate(),
    'YTD': createAggregate(),
  };

  rides.forEach((ride) => {
    const rideTimestamp = parseStartTime(ride.startTime);
    if (rideTimestamp === null) return;
    if (!Number.isFinite(rideTimestamp)) return;

    TIMEFRAMES.forEach((tf) => {
      if (rideTimestamp < thresholds[tf]) return;
      const agg = aggregates[tf];
      const distance = Math.max(ride.distanceMiles ?? 0, 0);
      const elevation = Math.max(ride.elevationGainFeet ?? 0, 0);
      const rideHours = Math.max(ride.durationSeconds ?? 0, 0) * SECONDS_TO_HOURS;

      agg.distance += distance;
      agg.elevation += elevation;
      agg.hours += rideHours;

      const bikeLabel =
        (ride.bikeId ? bikeNameMap.get(ride.bikeId) : null) ?? UNASSIGNED_BIKE_LABEL;
      agg.bikeHours.set(bikeLabel, (agg.bikeHours.get(bikeLabel) ?? 0) + rideHours);
    });
  });

  const finalize = (agg: MutableAggregate): RideStats => ({
    distance: Number(agg.distance.toFixed(1)),
    elevation: Math.round(agg.elevation),
    hours: Number(agg.hours.toFixed(1)),
    bikeTime: Array.from(agg.bikeHours.entries())
      .map(([name, hours]) => ({ name, hours: Number(hours.toFixed(1)) }))
      .sort((a, b) => b.hours - a.hours),
  });

  return {
    '1w': finalize(aggregates['1w']),
    '1m': finalize(aggregates['1m']),
    '3m': finalize(aggregates['3m']),
    'YTD': finalize(aggregates['YTD']),
  };
};

export default function RideStatsCard() {
  const [selectedTf, setSelectedTf] = useState<Timeframe>('1w');
  const {
    data: ridesData,
    loading: ridesLoading,
    error: ridesError,
  } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: { take: MAX_RIDES_FOR_STATS },
    fetchPolicy: 'cache-first',
  });
  const { data: bikesData } = useQuery<{ bikes: BikeSummary[] }>(BIKES, {
    fetchPolicy: 'cache-first',
  });

  const bikeNames = useMemo(
    () => buildBikeNameMap(bikesData?.bikes ?? []),
    [bikesData?.bikes]
  );
  const stats = useMemo(
    () => computeRideStats(ridesData?.rides ?? [], bikeNames),
    [ridesData?.rides, bikeNames]
  );
  const selectedStats = stats[selectedTf] ?? EMPTY_STATS;
  const hasRides = (ridesData?.rides?.length ?? 0) > 0;

  return (
    <>
      <h2 className="text-xl font-bold mb-2">Ride Stats</h2>
      {ridesError && (
        <div className="text-sm text-red-600 mb-2">
          Couldn't load ride stats. {ridesError.message}
        </div>
      )}
      {ridesLoading && !hasRides ? (
        <div className="h-48 rounded-md bg-gray-100 animate-pulse" />
      ) : !hasRides ? (
        <div className="text-sm text-gray-600">Log rides to unlock your stats.</div>
      ) : (
        <>
          <TimeframeSelector selected={selectedTf} onSelect={setSelectedTf} />
          <StatsSummary {...selectedStats} />
          {selectedStats.bikeTime.length > 0 ? (
            <BikeUsageChart data={selectedStats.bikeTime} />
          ) : (
            <div className="text-sm text-gray-600">No bike usage data for this timeframe.</div>
          )}
        </>
      )}
    </>
  );
}
