// src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import { ADD_RIDE } from '../graphql/addRide';
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
} from '../components/dashboard';

interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
}

const RECENT_COUNT = 10;

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

  // Mutations
  const [addRide] = useMutation(ADD_RIDE);

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
  const [isSimulatingRide, setIsSimulatingRide] = useState(false);

  // Effects
  useEffect(() => {
    if (unmappedData?.unmappedStravaGears?.length > 0) {
      setUnmappedGears(unmappedData.unmappedStravaGears);
      setShowGearMapping(true);
    }
  }, [unmappedData]);

  // Handlers
  const handleLogService = () => {
    setIsLogServiceOpen(true);
  };

  const handleSimulateGarminRide = async () => {
    if (bikes.length === 0) {
      alert('Please add a bike first to test Garmin rides.');
      return;
    }

    setIsSimulatingRide(true);
    try {
      const now = new Date();
      const mockRideData = {
        startTime: now.toISOString(),
        durationSeconds: Math.floor(Math.random() * 3600) + 1800,
        distanceMiles: parseFloat((Math.random() * 15 + 5).toFixed(2)),
        elevationGainFeet: Math.floor(Math.random() * 2000) + 500,
        averageHr: Math.floor(Math.random() * 40) + 140,
        rideType: 'TRAIL',
        notes: 'TEST: Simulated Garmin ride from watch',
        trailSystem: 'Mock Trail System',
        location: 'Test Location',
      };

      await addRide({
        variables: { input: mockRideData },
      });

      await refetchRides();
      alert('Simulated Garmin ride created successfully!');
    } catch (err) {
      console.error('Failed to simulate Garmin ride:', err);
      alert('Failed to simulate ride. Check console for details.');
    } finally {
      setIsSimulatingRide(false);
    }
  };

  const handleSimulateLongGarminRide = async () => {
    if (bikes.length === 0) {
      alert('Please add a bike first to test Garmin rides.');
      return;
    }

    setIsSimulatingRide(true);
    try {
      const now = new Date();
      const mockRideData = {
        startTime: now.toISOString(),
        durationSeconds: Math.floor(Math.random() * 36000) + 180000,
        distanceMiles: parseFloat((Math.random() * 200 + 300).toFixed(2)),
        elevationGainFeet: Math.floor(Math.random() * 20000) + 30000,
        averageHr: Math.floor(Math.random() * 40) + 140,
        rideType: 'TRAIL',
        notes: 'TEST: Simulated LONG Garmin ride from watch (50+ hours)',
        trailSystem: 'Epic Long Trail System',
        location: 'Test Location',
      };

      await addRide({
        variables: { input: mockRideData },
      });

      await refetchRides();
      alert('Simulated long Garmin ride created successfully!');
    } catch (err) {
      console.error('Failed to simulate long Garmin ride:', err);
      alert('Failed to simulate ride. Check console for details.');
    } finally {
      setIsSimulatingRide(false);
    }
  };

  const isAdmin = user?.role === 'ADMIN';

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
              isAdmin={isAdmin}
              isSimulatingRide={isSimulatingRide}
              onTestRide={handleSimulateGarminRide}
              onLongRide={handleSimulateLongGarminRide}
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
            <RecentRidesCard rides={rides} loading={ridesLoading} />
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
    </>
  );
}
