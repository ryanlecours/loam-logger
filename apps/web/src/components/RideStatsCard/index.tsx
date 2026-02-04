import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import {
  FaHashtag,
  FaChartLine,
  FaHeartbeat,
  FaMapMarkerAlt,
  FaBicycle,
} from 'react-icons/fa';

import TimeframeDropdown from './TimeframeDropdown';
import BikeFilterDropdown from './BikeFilterDropdown';
import StatsSummary from './StatsSummary';
import ExpandableSection from './ExpandableSection';
import RideCountSection from './sections/RideCountSection';
import TrendsSection from './sections/TrendsSection';
import HeartRateSection from './sections/HeartRateSection';
import LocationSection from './sections/LocationSection';
import BikeUsageSection from './sections/BikeUsageSection';

import { useRideStats, useRideStatsForRides, useRideStatsForYear, buildBikeNameMap, getYearsWithRides } from './hooks/useRideStats';
import { RIDES } from '../../graphql/rides';
import { BIKES } from '../../graphql/bikes';
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
  const bikeOptions = useMemo(() => {
    if (!bikesData?.bikes) return [];
    return bikesData.bikes.map((bike) => ({
      id: bike.id,
      name: bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim() || 'Bike',
    }));
  }, [bikesData?.bikes]);

  // Determine which stats to show
  const selectedStats = useMemo(() => {
    if (isExternalMode) return externalStats;
    if (selectedYear !== null) return yearStats;
    if (isPresetTimeframe(selectedTf)) return internalStats[selectedTf] ?? EMPTY_STATS;
    return EMPTY_STATS;
  }, [isExternalMode, externalStats, selectedYear, yearStats, selectedTf, internalStats]);

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
                icon={<FaHashtag size={14} />}
              >
                <RideCountSection stats={selectedStats.rideCount} />
              </ExpandableSection>

              <ExpandableSection
                title="Trends & Streaks"
                icon={<FaChartLine size={14} />}
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
                icon={<FaHeartbeat size={14} />}
                isEmpty={selectedStats.heartRate.averageHr === null}
                emptyMessage="No heart rate data available"
              >
                <HeartRateSection stats={selectedStats.heartRate} />
              </ExpandableSection>

              <ExpandableSection
                title="Locations"
                icon={<FaMapMarkerAlt size={14} />}
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
                icon={<FaBicycle size={14} />}
                isEmpty={selectedStats.bikeTime.length === 0}
                emptyMessage="No bike data for this timeframe"
              >
                <BikeUsageSection data={selectedStats.bikeTime} />
              </ExpandableSection>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
