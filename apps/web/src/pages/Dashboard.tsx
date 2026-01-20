// src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import { UNMAPPED_STRAVA_GEARS } from '../graphql/stravaGear';
import { useImportNotificationState } from '../graphql/importSession';
import StravaGearMappingModal from '../components/StravaGearMappingModal';
import StravaImportModal from '../components/StravaImportModal';
import { ImportCompleteOverlay } from '../components/ImportCompleteOverlay';
import RideStatsCard from '../components/RideStatsCard';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useUserTier } from '../hooks/useUserTier';
import { useConnectedAccounts } from '../hooks/useConnectedAccounts';
import { usePriorityBike, type BikeWithPredictions } from '../hooks/usePriorityBike';
import { FaChevronDown } from 'react-icons/fa';
import {
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

const apiBase =
  (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') ||
  (import.meta.env.DEV ? 'http://localhost:4000' : '');

export default function Dashboard() {
  const user = useCurrentUser().user;
  const { isPro, isAdmin } = useUserTier();
  const { isStravaConnected } = useConnectedAccounts();

  // Strava connections temporarily disabled for non-admin users
  const isStravaDisabled = !isAdmin;

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

  // Import notification state (for backfill completion overlay)
  const { data: importNotificationData } = useImportNotificationState({
    pollInterval: 30000, // Check every 30 seconds
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
  const [isStravaImportOpen, setIsStravaImportOpen] = useState(false);
  const [isImportOverlayOpen, setIsImportOverlayOpen] = useState(false);

  // Show import overlay when notification state indicates we should
  const importState = importNotificationData?.importNotificationState;
  useEffect(() => {
    if (importState?.showOverlay && !isImportOverlayOpen) {
      setIsImportOverlayOpen(true);
    }
  }, [importState?.showOverlay, isImportOverlayOpen]);

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

  const handleStravaBackfill = () => {
    if (isStravaConnected) {
      setIsStravaImportOpen(true);
    } else if (!isStravaDisabled) {
      // Redirect to Strava OAuth (only if not disabled)
      window.location.href = `${apiBase}/auth/strava/start`;
    }
    // If Strava is disabled and not connected, do nothing (button should be hidden/disabled by PriorityBikeHero)
  };

  return (
    <>
      <div className="dashboard-stacked-layout">
        {/* Section 1: Bike Health */}
        <section className="bike-health-section">
          <PriorityBikeHero
            bike={displayedBike}
            isShowingPriority={isShowingPriority}
            onResetToPriority={resetToPriority}
            onLogService={handleLogService}
            onStravaBackfill={handleStravaBackfill}
            isStravaConnected={isStravaConnected}
            isStravaDisabled={isStravaDisabled}
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

          {/* Scroll indicator */}
          <div className="scroll-indicator" aria-hidden="true">
            <FaChevronDown className="scroll-indicator-icon" />
          </div>
        </section>

        {/* Section 2: Rides & Stats */}
        <section className="rides-stats-section">
          <div className="rides-stats-grid">
            <RecentRidesCard
              rides={rides}
              bikes={bikes}
              loading={ridesLoading}
              onLinkBike={setRideToLink}
            />
            <div className="ride-stats-compact">
              <RideStatsCard showHeading={true} />
            </div>
          </div>
        </section>
      </div>

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

      {/* Strava Import Modal */}
      <StravaImportModal
        open={isStravaImportOpen}
        onClose={() => setIsStravaImportOpen(false)}
        onSuccess={() => {
          refetchRides();
          setIsStravaImportOpen(false);
        }}
      />

      {/* Import Complete Overlay */}
      <ImportCompleteOverlay
        isOpen={isImportOverlayOpen}
        onClose={() => setIsImportOverlayOpen(false)}
        sessionId={importState?.sessionId ?? null}
        unassignedRideCount={importState?.unassignedRideCount ?? 0}
        totalImportedCount={importState?.totalImportedCount ?? 0}
      />
    </>
  );
}
