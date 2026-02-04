// src/pages/Dashboard.tsx
import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { RIDES } from '../graphql/rides';
import { BIKES, BIKES_LIGHT } from '../graphql/bikes';
import { UNMAPPED_STRAVA_GEARS } from '../graphql/stravaGear';
import { useImportNotificationState } from '../graphql/importSession';
import { useCalibrationState } from '../graphql/calibration';
import { useMarkPairedComponentMigrationSeen, useMigratePairedComponents } from '../graphql/userPreferences';
import StravaGearMappingModal from '../components/StravaGearMappingModal';
import StravaImportModal from '../components/StravaImportModal';
import { ImportCompleteOverlay } from '../components/ImportCompleteOverlay';
import { CalibrationOverlay } from '../components/CalibrationOverlay';
import { PairedComponentMigrationNotice } from '../components/PairedComponentMigrationNotice';
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

// Cutoff date for showing migration notice - users created after this date
// get paired components by default and don't need to see the notice
const MIGRATION_CUTOFF_DATE = new Date('2026-01-29T23:59:59Z');

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
  const { user, refetch: refetchUser } = useCurrentUser();
  const { isPro } = useUserTier();
  const { isStravaConnected } = useConnectedAccounts();
  const navigate = useNavigate();
  const [markMigrationSeen] = useMarkPairedComponentMigrationSeen();
  const [migratePairedComponents] = useMigratePairedComponents();

  // Queries
  const {
    data: ridesData,
    loading: ridesLoading,
    refetch: refetchRides,
  } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: { take: RECENT_COUNT },
    fetchPolicy: 'cache-first',
  });

  // First load bikes without predictions (fast)
  const {
    data: bikesLightData,
    loading: bikesLightLoading,
    refetch: refetchBikesLight,
  } = useQuery<{ bikes: BikeWithPredictions[] }>(BIKES_LIGHT, {
    fetchPolicy: 'cache-and-network',
  });

  // Then load predictions in the background
  const {
    data: bikesFullData,
    refetch: refetchBikesFull,
  } = useQuery<{ bikes: BikeWithPredictions[] }>(BIKES, {
    fetchPolicy: 'cache-and-network',
    skip: !bikesLightData, // Only fetch once we have the light data
  });

  // Use full data if available, otherwise fall back to light data
  const bikesData = bikesFullData || bikesLightData;
  const bikesLoading = bikesLightLoading;
  const refetchBikes = async () => {
    await refetchBikesLight();
    await refetchBikesFull();
  };

  const { data: unmappedData } = useQuery(UNMAPPED_STRAVA_GEARS, {
    pollInterval: 60000,
    skip: !user,
  });

  // Import notification state (for backfill completion overlay)
  // Poll every 60 seconds to match the backend import session checker interval
  const { data: importNotificationData } = useImportNotificationState({
    pollInterval: 60000,
  });

  // Calibration state (for first-time component calibration overlay)
  const { data: calibrationData } = useCalibrationState();

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
  const [logServiceComponentId, setLogServiceComponentId] = useState<string | null>(null);
  const [rideToLink, setRideToLink] = useState<Ride | null>(null);
  const [isStravaImportOpen, setIsStravaImportOpen] = useState(false);
  const [isImportOverlayOpen, setIsImportOverlayOpen] = useState(false);
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [isMigrationNoticeOpen, setIsMigrationNoticeOpen] = useState(false);
  const [hasMigrationRun, setHasMigrationRun] = useState(false);

  // Run paired component migration on first dashboard load for users created before cutoff
  // This runs independently of the notice - migration happens regardless
  useEffect(() => {
    if (!user || hasMigrationRun) return;

    // Only run for users created on or before the cutoff date
    const userCreatedAt = user.createdAt ? new Date(user.createdAt) : null;
    if (!userCreatedAt || userCreatedAt > MIGRATION_CUTOFF_DATE) return;

    setHasMigrationRun(true);
    migratePairedComponents()
      .then(() => {
        // Refetch bikes to get updated components
        refetchBikes();
      })
      .catch(() => {
        // Silent fail - migration is best-effort and idempotent
        // User can still use the app normally, migration will retry on next load
      });
  }, [user, hasMigrationRun, migratePairedComponents, refetchBikes]);

  // Determine if we should show the paired component migration notice
  const shouldShowMigrationNotice = useMemo(() => {
    if (!user) return false;
    // Only show to users created on or before the cutoff date
    const userCreatedAt = user.createdAt ? new Date(user.createdAt) : null;
    if (!userCreatedAt || userCreatedAt > MIGRATION_CUTOFF_DATE) return false;
    // Only show if they haven't dismissed it yet
    if (user.pairedComponentMigrationSeenAt) return false;
    return true;
  }, [user]);

  // Show migration notice when conditions are met
  // Only show after other overlays are closed (import, calibration)
  useEffect(() => {
    if (
      shouldShowMigrationNotice &&
      !isMigrationNoticeOpen &&
      !isImportOverlayOpen &&
      !isCalibrationOpen
    ) {
      setIsMigrationNoticeOpen(true);
    }
  }, [shouldShowMigrationNotice, isMigrationNoticeOpen, isImportOverlayOpen, isCalibrationOpen]);

  // Handle migration notice dismissal
  const handleMigrationDismiss = async (reviewNow: boolean) => {
    try {
      await markMigrationSeen();
      refetchUser();
    } catch (err) {
      console.error('Failed to mark migration seen:', err);
    }
    setIsMigrationNoticeOpen(false);
    if (reviewNow) {
      navigate('/gear');
    }
  };

  // Show import overlay when notification state indicates we should
  const importState = importNotificationData?.importNotificationState;
  useEffect(() => {
    if (importState?.showOverlay && !isImportOverlayOpen) {
      setIsImportOverlayOpen(true);
    }
  }, [importState?.showOverlay, isImportOverlayOpen]);

  // Show calibration overlay when conditions are met
  // Only show if import overlay is not currently open (calibration comes after import)
  const calibrationState = calibrationData?.calibrationState;
  useEffect(() => {
    if (
      calibrationState?.showOverlay &&
      !isCalibrationOpen &&
      !isImportOverlayOpen
    ) {
      setIsCalibrationOpen(true);
    }
  }, [calibrationState?.showOverlay, isCalibrationOpen, isImportOverlayOpen]);

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
  const handleLogService = (componentId?: string) => {
    setLogServiceComponentId(componentId ?? null);
    setIsLogServiceOpen(true);
  };

  const handleStravaBackfill = () => {
    if (isStravaConnected) {
      setIsStravaImportOpen(true);
    } else {
      // Redirect to Strava OAuth
      window.location.href = `${apiBase}/auth/strava/start`;
    }
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
        key={logServiceComponentId ?? 'default'}
        isOpen={isLogServiceOpen}
        onClose={() => {
          setIsLogServiceOpen(false);
          setLogServiceComponentId(null);
        }}
        bike={displayedBike}
        defaultComponentId={logServiceComponentId ?? displayedBike?.predictions?.priorityComponent?.componentId}
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
        bikes={bikes}
      />

      {/* Calibration Overlay - handles dismiss/complete internally */}
      <CalibrationOverlay
        isOpen={isCalibrationOpen}
        onClose={() => setIsCalibrationOpen(false)}
      />

      {/* Paired Component Migration Notice - one-time for existing users */}
      <PairedComponentMigrationNotice
        isOpen={isMigrationNoticeOpen}
        onReviewNow={() => handleMigrationDismiss(true)}
        onMaybeLater={() => handleMigrationDismiss(false)}
      />
    </>
  );
}
