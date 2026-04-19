import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import {
  Hash,
  TrendingUp,
  HeartPulse,
  MapPin,
  Bike,
  CloudSun,
} from 'lucide-react';

import TimeframeDropdown from './TimeframeDropdown';
import BikeFilterDropdown from './BikeFilterDropdown';
import StatsSummary from './StatsSummary';
import ExpandableSection from './ExpandableSection';
import RideCountSection from './sections/RideCountSection';
import TrendsSection from './sections/TrendsSection';
import HeartRateSection from './sections/HeartRateSection';
import LocationSection from './sections/LocationSection';
import BikeUsageSection from './sections/BikeUsageSection';
import WeatherSection from './sections/WeatherSection';

import { useRideStats, useRideStatsForRides, useRideStatsForYear, buildBikeNameMap, getYearsWithRides } from './hooks/useRideStats';
import { RIDES } from '../../graphql/rides';
import { BIKES } from '../../graphql/bikes';
import { WEATHER_BREAKDOWN } from '../../graphql/weatherBreakdown';
import type { Ride } from '../../models/Ride';
import type { Timeframe, PresetTimeframe } from './types';
import { EMPTY_STATS } from './types';

/** Check if a timeframe is a preset (not a year number) */
const isPresetTimeframe = (tf: Timeframe): tf is PresetTimeframe => {
  return typeof tf === 'string';
};

type BikeSummary = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

// 400 rides accounts for ~1 ride/day for a year plus some twice-a-day rides
const MAX_RIDES_FOR_STATS = 400;

const DAYS_MS = 24 * 60 * 60 * 1000;

/** Converts a Timeframe to the RidesFilterInput shape the API expects. */
const timeframeToFilter = (tf: Timeframe, bikeId: string | null) => {
  const now = new Date();
  let startDate: Date;
  let endDate: Date | undefined;

  if (typeof tf === 'number') {
    startDate = new Date(tf, 0, 1);
    endDate = new Date(tf + 1, 0, 1);
  } else if (tf === '1w') {
    startDate = new Date(now.getTime() - 7 * DAYS_MS);
  } else if (tf === '1m') {
    startDate = new Date(now.getTime() - 30 * DAYS_MS);
  } else if (tf === '3m') {
    startDate = new Date(now.getTime() - 90 * DAYS_MS);
  } else {
    // YTD
    startDate = new Date(now.getFullYear(), 0, 1);
  }

  return {
    startDate: startDate.toISOString(),
    ...(endDate ? { endDate: endDate.toISOString() } : {}),
    ...(bikeId ? { bikeId } : {}),
  };
};

interface RideStatsCardProps {
  showHeading?: boolean;
  /** When provided, uses these rides instead of fetching. Hides timeframe dropdown. */
  rides?: Ride[];
  /** Label describing the external filter (e.g., "Last 30 days", "2024") */
  filterLabel?: string;
}

export default function RideStatsCard({ showHeading = true, rides: externalRides, filterLabel }: RideStatsCardProps) {
  const [selectedTf, setSelectedTf] = useState<Timeframe>('YTD');
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(null);
  const isExternalMode = externalRides !== undefined;

  const {
    data: ridesData,
    loading: ridesLoading,
    error: ridesError,
  } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: {
      take: MAX_RIDES_FOR_STATS,
      filter: selectedBikeId ? { bikeId: selectedBikeId } : undefined,
    },
    fetchPolicy: 'cache-first',
    skip: isExternalMode,
  });

  const { data: bikesData } = useQuery<{ bikes: BikeSummary[] }>(BIKES, {
    fetchPolicy: 'cache-first',
  });

  const bikeNames = useMemo(
    () => buildBikeNameMap(bikesData?.bikes ?? []),
    [bikesData?.bikes]
  );

  const allRides = useMemo(
    () => ridesData?.rides ?? [],
    [ridesData?.rides]
  );

  // True when the server returned a full page — the user has ≥ the cap
  // and client-computed stats (streaks, PRs, totals) may be incomplete.
  // Weather breakdown uses the server-side aggregation and is unaffected.
  const truncated = !isExternalMode && allRides.length >= MAX_RIDES_FOR_STATS;

  // Stats from internal timeframe-based fetching (presets only)
  const internalStats = useRideStats({
    rides: allRides,
    bikeNameMap: bikeNames,
  });

  // Stats from externally provided rides
  const externalStats = useRideStatsForRides({
    rides: externalRides ?? [],
    bikeNameMap: bikeNames,
  });

  // Stats for a specific year (when a year is selected)
  const selectedYear = typeof selectedTf === 'number' ? selectedTf : null;
  const yearStats = useRideStatsForYear(allRides, bikeNames, selectedYear ?? 0);

  // Get available years for the dropdown
  const availableYears = useMemo(
    () => getYearsWithRides(allRides),
    [allRides]
  );

  // Build bike options for dropdown
  const bikes = bikesData?.bikes;
  const bikeOptions = useMemo(() => {
    if (!bikes) return [];
    return bikes.map((bike) => ({
      id: bike.id,
      name: bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim() || 'Bike',
    }));
  }, [bikes]);

  // Server-side aggregation for weather — avoids iterating the full rides
  // list client-side just to count buckets. Skipped in external mode
  // because the parent is already providing pre-computed stats.
  const weatherFilter = useMemo(
    () => timeframeToFilter(selectedTf, selectedBikeId),
    [selectedTf, selectedBikeId]
  );
  const { data: weatherData } = useQuery<{
    me: {
      id: string;
      weatherBreakdown: {
        sunny: number;
        cloudy: number;
        rainy: number;
        snowy: number;
        windy: number;
        foggy: number;
        unknown: number;
        pending: number;
        totalRides: number;
      };
    } | null;
  }>(WEATHER_BREAKDOWN, {
    variables: { filter: weatherFilter },
    fetchPolicy: 'cache-and-network',
    skip: isExternalMode,
  });

  // Determine which stats to show, overriding the client-computed weather
  // block with the server aggregation when available.
  const selectedStats = useMemo(() => {
    let base;
    if (isExternalMode) base = externalStats;
    else if (selectedYear !== null) base = yearStats;
    else if (isPresetTimeframe(selectedTf)) base = internalStats[selectedTf] ?? EMPTY_STATS;
    else base = EMPTY_STATS;

    const wb = weatherData?.me?.weatherBreakdown;
    if (!wb || isExternalMode) return base;

    const totalWithWeather = wb.sunny + wb.cloudy + wb.rainy + wb.snowy + wb.windy + wb.foggy + wb.unknown;
    return {
      ...base,
      weather: {
        breakdown: {
          SUNNY: wb.sunny,
          CLOUDY: wb.cloudy,
          RAINY: wb.rainy,
          SNOWY: wb.snowy,
          WINDY: wb.windy,
          FOGGY: wb.foggy,
          UNKNOWN: wb.unknown,
        },
        totalWithWeather,
        totalRides: wb.totalRides,
      },
    };
  }, [isExternalMode, externalStats, selectedYear, yearStats, selectedTf, internalStats, weatherData]);

  const hasRides = isExternalMode ? (externalRides?.length ?? 0) > 0 : allRides.length > 0;

  return (
    <div className="ride-stats-card">
      {/* Header with title and dropdowns */}
      <div className="stats-header">
        {showHeading && <h2 className="stats-title">Ride Stats</h2>}
        {hasRides && !isExternalMode && (
          <div className="stats-filters">
            {bikeOptions.length > 1 && (
              <BikeFilterDropdown
                bikes={bikeOptions}
                selected={selectedBikeId}
                onSelect={setSelectedBikeId}
              />
            )}
            <TimeframeDropdown
              selected={selectedTf}
              onSelect={setSelectedTf}
              availableYears={availableYears}
            />
          </div>
        )}
        {hasRides && isExternalMode && filterLabel && (
          <span className="text-sm text-muted">{filterLabel}</span>
        )}
      </div>

      {truncated && (
        <p className="text-xs text-muted italic px-4 pb-2">
          Showing stats based on your most recent {MAX_RIDES_FOR_STATS} rides.
          Weather totals cover the full selected timeframe.
        </p>
      )}

      {/* Scrollable content area */}
      <div className="stats-content">
        {/* Error state */}
        {ridesError && (
          <div className="stats-error">
            Couldn't load ride stats. {ridesError.message}
          </div>
        )}

        {/* Loading state */}
        {!isExternalMode && ridesLoading && !hasRides ? (
          <div className="stats-skeleton" />
        ) : !hasRides ? (
          <div className="stats-empty">Log rides to unlock your stats.</div>
        ) : (
          <>
            {/* Primary stats - always visible */}
            <StatsSummary
              distance={selectedStats.distance}
              elevation={selectedStats.elevation}
              hours={selectedStats.hours}
            />

            {/* Expandable sections */}
            <div className="stats-sections">
              <ExpandableSection
                title="Ride Count & Averages"
                subtitle={`${selectedStats.rideCount.totalRides} rides`}
                icon={<Hash size={14} />}
              >
                <RideCountSection stats={selectedStats.rideCount} />
              </ExpandableSection>

              <ExpandableSection
                title="Trends & Streaks"
                icon={<TrendingUp size={14} />}
                isEmpty={selectedStats.rideCount.totalRides < 2}
                emptyMessage="Need more rides for trends"
              >
                <TrendsSection stats={selectedStats.trends} />
              </ExpandableSection>

              <ExpandableSection
                title="Heart Rate"
                subtitle={
                  selectedStats.heartRate.averageHr
                    ? `${selectedStats.heartRate.averageHr} avg`
                    : undefined
                }
                icon={<HeartPulse size={14} />}
                isEmpty={selectedStats.heartRate.averageHr === null}
                emptyMessage="No heart rate data available"
              >
                <HeartRateSection stats={selectedStats.heartRate} />
              </ExpandableSection>

              <ExpandableSection
                title="Locations"
                icon={<MapPin size={14} />}
                isEmpty={
                  selectedStats.locations.topLocations.length === 0 &&
                  selectedStats.locations.topTrailSystems.length === 0
                }
                emptyMessage="No location data available"
              >
                <LocationSection stats={selectedStats.locations} />
              </ExpandableSection>

              <ExpandableSection
                title="Bike Usage"
                icon={<Bike size={14} />}
                isEmpty={selectedStats.bikeTime.length === 0}
                emptyMessage="No bike data for this timeframe"
              >
                <BikeUsageSection data={selectedStats.bikeTime} />
              </ExpandableSection>

              <ExpandableSection
                title="Weather"
                icon={<CloudSun size={14} />}
                isEmpty={selectedStats.weather.totalWithWeather === 0}
                emptyMessage="No weather data yet for this timeframe"
              >
                <WeatherSection stats={selectedStats.weather} />
              </ExpandableSection>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
