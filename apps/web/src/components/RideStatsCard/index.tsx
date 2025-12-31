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
import StatsSummary from './StatsSummary';
import ExpandableSection from './ExpandableSection';
import RideCountSection from './sections/RideCountSection';
import TrendsSection from './sections/TrendsSection';
import HeartRateSection from './sections/HeartRateSection';
import LocationSection from './sections/LocationSection';
import BikeUsageSection from './sections/BikeUsageSection';

import { useRideStats, buildBikeNameMap } from './hooks/useRideStats';
import { RIDES } from '../../graphql/rides';
import { BIKES } from '../../graphql/bikes';
import type { Ride } from '../../models/Ride';
import type { Timeframe } from './types';
import { EMPTY_STATS } from './types';

type BikeSummary = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

const MAX_RIDES_FOR_STATS = 200;

interface RideStatsCardProps {
  showHeading?: boolean;
}

export default function RideStatsCard({ showHeading = true }: RideStatsCardProps) {
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

  const stats = useRideStats({
    rides: ridesData?.rides ?? [],
    bikeNameMap: bikeNames,
  });

  const selectedStats = stats[selectedTf] ?? EMPTY_STATS;
  const hasRides = (ridesData?.rides?.length ?? 0) > 0;

  return (
    <div className="ride-stats-card">
      {/* Header with title and dropdown */}
      <div className="stats-header">
        {showHeading && <h2 className="stats-title">Ride Stats</h2>}
        {hasRides && (
          <TimeframeDropdown selected={selectedTf} onSelect={setSelectedTf} />
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
        {ridesLoading && !hasRides ? (
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
