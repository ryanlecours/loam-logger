// src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import { UNMAPPED_STRAVA_GEARS } from '../graphql/stravaGear';
import StravaGearMappingModal from '../components/StravaGearMappingModal';
import RideStatsCard from '../components/RideStatsCard';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useUserTier } from '../hooks/useUserTier';
import { usePriorityBike, type BikeWithPredictions } from '../hooks/usePriorityBike';
import {
  DashboardLayout,
  PriorityBikeHero,
  BikeSwitcherRow,
  RecentRidesCard,
  LogServiceModal,
  LinkBikeModal,
} from '../components/dashboard';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType?: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

const RECENT_COUNT = 20;

export default function Dashboard() {
  const user = useCurrentUser().user;
  const { isPro } = useUserTier();

  // Queries
  const {
    data: ridesData,
    loading: ridesLoading,
    refetch: refetchRides,
  } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: { take: RECENT_COUNT },
    fetchPolicy: 'cache-first',
  });

  const {
    data: bikesData,
    loading: bikesLoading,
  } = useQuery<{ bikes: BikeWithPredictions[] }>(BIKES, {
    fetchPolicy: 'cache-and-network',
  });

  const { data: unmappedData } = useQuery(UNMAPPED_STRAVA_GEARS, {
    pollInterval: 60000,
    skip: !user,
  });

  // Derived data
  const rides = ridesData?.rides ?? [];
  const bikes = bikesData?.bikes ?? [];

  // Priority bike selection
  const {
    displayedBike,
    isShowingPriority,
    selectBike,
    resetToPriority,
    sortedBikes,
  } = usePriorityBike(bikes);

  // Modal state
  const [showGearMapping, setShowGearMapping] = useState(false);
  const [unmappedGears, setUnmappedGears] = useState<Array<{ gearId: string; rideCount: number }>>([]);
  const [isLogServiceOpen, setIsLogServiceOpen] = useState(false);
  const [rideToLink, setRideToLink] = useState<Ride | null>(null);

  // Effects
  useEffect(() => {
    if (unmappedData?.unmappedStravaGears?.length > 0) {
      const isSnoozed = localStorage.getItem('loam-strava-mapping-snoozed') === 'true';
      setUnmappedGears(unmappedData.unmappedStravaGears);
      if (!isSnoozed) {
        setShowGearMapping(true);
      }
    }
  }, [unmappedData]);

  // Handlers
  const handleLogService = () => {
    setIsLogServiceOpen(true);
  };

  return (
    <>
      <DashboardLayout
        main={
          <>
            <PriorityBikeHero
              bike={displayedBike}
              isShowingPriority={isShowingPriority}
              onResetToPriority={resetToPriority}
              onLogService={handleLogService}
              loading={bikesLoading}
              rides={rides}
            />
            {isPro && sortedBikes.length > 1 && (
              <BikeSwitcherRow
                bikes={sortedBikes}
                selectedBikeId={displayedBike?.id ?? null}
                onSelect={selectBike}
              />
            )}
          </>
        }
        sidebar={
          <>
            <RecentRidesCard
              rides={rides}
              bikes={bikes}
              loading={ridesLoading}
              onLinkBike={setRideToLink}
            />
            <div className="ride-stats-compact">
              <RideStatsCard showHeading={true} />
            </div>
          </>
        }
      />

      {/* Log Service Modal */}
      <LogServiceModal
        isOpen={isLogServiceOpen}
        onClose={() => setIsLogServiceOpen(false)}
        bike={displayedBike}
        defaultComponentId={displayedBike?.predictions?.priorityComponent?.componentId}
      />

      {/* Strava Gear Mapping Modal */}
      {showGearMapping && unmappedGears.length > 0 && (
        <StravaGearMappingModal
          open={showGearMapping}
          onClose={() => setShowGearMapping(false)}
          onSuccess={() => {
            refetchRides();
            setUnmappedGears([]);
          }}
          unmappedGears={unmappedGears}
          trigger="webhook"
        />
      )}

      {/* Link Bike Modal */}
      {rideToLink && (
        <LinkBikeModal
          ride={rideToLink}
          bikes={bikes}
          onClose={() => setRideToLink(null)}
          onSuccess={() => refetchRides()}
        />
      )}
    </>
  );
}
