// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import { ADD_RIDE } from '../graphql/addRide';
import { UNMAPPED_STRAVA_GEARS } from '../graphql/stravaGear';
import RideCard from '../components/RideCard';
import RideStatsCard from '../components/RideStatsCard';
import StravaGearMappingModal from '../components/StravaGearMappingModal';
import { BikeHealthHero } from '../components/BikeHealthHero';
import { BikeHealthModal } from '../components/BikeHealthModal';
import { useCurrentUser } from '../hooks/useCurrentUser.ts';
import { transformToHealthData, type BikeSummary } from '../utils/transformToHealthData';
import { useRideStats, buildBikeNameMap } from '../components/RideStatsCard/hooks/useRideStats';
import type { Ride as RideModel } from '../models/Ride';

type Ride = {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
};

const RECENT_COUNT = 5;
const STATS_RIDE_COUNT = 200;

export default function Dashboard() {
  const user = useCurrentUser().user;
  const firstName = user?.name?.split(' ')?.[0] ?? 'Rider';

  // Queries
  const {
    data: ridesData,
    loading: ridesLoading,
    error: ridesError,
    refetch: refetchRides,
  } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: { take: RECENT_COUNT },
    fetchPolicy: 'cache-first',
  });

  // Separate query for stats (more rides needed)
  const { data: statsRidesData } = useQuery<{ rides: RideModel[] }>(RIDES, {
    variables: { take: STATS_RIDE_COUNT },
    fetchPolicy: 'cache-first',
  });

  const {
    data: bikesData,
    loading: bikesLoading,
    error: bikesError,
  } = useQuery<{ bikes: BikeSummary[] }>(BIKES, {
    fetchPolicy: 'cache-and-network',
  });

  const { data: unmappedData } = useQuery(UNMAPPED_STRAVA_GEARS, {
    pollInterval: 60000,
    skip: !user,
  });

  // Mutations
  const [addRide] = useMutation(ADD_RIDE);

  // State
  const [isSimulatingRide, setIsSimulatingRide] = useState(false);
  const [showGearMapping, setShowGearMapping] = useState(false);
  const [unmappedGears, setUnmappedGears] = useState<Array<{ gearId: string; rideCount: number }>>([]);
  const [gpxModalOpen, setGpxModalOpen] = useState(false);
  const [gpxBikeId, setGpxBikeId] = useState<string>('');
  const [gpxFileName, setGpxFileName] = useState<string>('');
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(null);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);

  // Derived data
  const rides = ridesData?.rides ?? [];
  const bikesRaw = useMemo(() => bikesData?.bikes ?? [], [bikesData]);
  const bikeHealthData = useMemo(
    () => transformToHealthData(bikesRaw),
    [bikesRaw]
  );
  const selectedBike = useMemo(
    () => bikeHealthData.find((b) => b.id === selectedBikeId) ?? null,
    [bikeHealthData, selectedBikeId]
  );

  // Compute ride stats for greeting insights
  const bikeNameMap = useMemo(
    () => buildBikeNameMap(bikesRaw),
    [bikesRaw]
  );
  const rideStats = useRideStats({
    rides: statsRidesData?.rides ?? [],
    bikeNameMap,
  });
  const weeklyStats = rideStats['1w'] ?? null;
  const allTimeStats = rideStats['ALL'] ?? null;

  // Effects
  useEffect(() => {
    if (unmappedData?.unmappedStravaGears?.length > 0) {
      setUnmappedGears(unmappedData.unmappedStravaGears);
      setShowGearMapping(true);
    }
  }, [unmappedData]);

  useEffect(() => {
    if (!gpxBikeId && bikesRaw.length > 0) {
      setGpxBikeId(bikesRaw[0].id);
    }
  }, [bikesRaw, gpxBikeId]);

  // Handlers
  const handleViewDetails = (bikeId: string) => {
    setSelectedBikeId(bikeId);
    setIsHealthModalOpen(true);
  };

  const handleLogService = (bikeId: string) => {
    setSelectedBikeId(bikeId);
    setIsHealthModalOpen(true);
  };

  const closeGpxModal = () => {
    setGpxModalOpen(false);
    setGpxFileName('');
  };

  const handleGpxFile = (file?: File) => {
    setGpxFileName(file?.name ?? '');
  };

  const handleGpxSubmit = () => {
    if (!gpxBikeId || !gpxFileName) return;
    alert('GPX upload coming soon.');
    closeGpxModal();
  };

  const handleSimulateGarminRide = async () => {
    if (bikesRaw.length === 0) {
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
    if (bikesRaw.length === 0) {
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

  return (
    <div className="dashboard-app">
      {/* Primary: Bike Health Hero */}
      <BikeHealthHero
        bikes={bikeHealthData}
        loading={bikesLoading}
        error={bikesError ?? undefined}
        firstName={firstName}
        onViewDetails={handleViewDetails}
        onLogService={handleLogService}
        onUploadGpx={() => setGpxModalOpen(true)}
        weeklyStats={weeklyStats}
        totalHoursAllTime={allTimeStats?.hours}
        devMode={{
          onTestRide: handleSimulateGarminRide,
          onLongRide: handleSimulateLongGarminRide,
          isSimulating: isSimulatingRide,
        }}
      />

      {/* Secondary: Recent Rides + Stats */}
      <div className="dashboard-secondary-grid">
        {/* Recent Rides */}
        <section className="data-card card-rides">
          <div className="card-header">
            <div className="card-label-group">
              <h2 className="card-title">Recent Rides</h2>
              <span className="card-count">
                {rides.length} of last {RECENT_COUNT}
              </span>
            </div>
            <Link to="/rides" className="card-action-link">
              View All
            </Link>
          </div>

          <div>
            {ridesLoading && (
              <div className="loading-state">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div key={idx} className="skeleton-item" />
                ))}
              </div>
            )}

            {ridesError && (
              <div className="error-state">
                <span className="error-icon">!</span>
                <p className="error-text">Unable to load rides: {ridesError.message}</p>
              </div>
            )}

            {!ridesLoading && !ridesError && rides.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">🏔️</span>
                <p className="empty-text">
                  No rides recorded yet.{' '}
                  <Link to="/rides" className="empty-link">
                    Log your first ride
                  </Link>{' '}
                  to start tracking your adventures.
                </p>
              </div>
            )}

            {!ridesLoading && !ridesError && rides.length > 0 && (
              <ul className="item-list">
                {rides.map((ride, idx) => (
                  <li
                    key={ride.id}
                    className="list-item"
                    style={{ animationDelay: `${idx * 0.08}s` }}
                  >
                    <RideCard ride={ride} bikes={bikesRaw} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Ride Stats - Compact */}
        <section className="data-card data-card-compact card-stats">
          <div className="card-header card-header-compact">
            <h2 className="card-title card-title-sm">Ride Stats</h2>
          </div>
          <RideStatsCard showHeading={false} />
        </section>
      </div>

      {/* Bike Health Modal */}
      <BikeHealthModal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
        bike={selectedBike}
      />

      {/* GPX Upload Modal */}
      {gpxModalOpen && (
        <div className="modal-overlay" onClick={closeGpxModal}>
          <div
            role="dialog"
            aria-modal="true"
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Upload GPX File</h3>
                <p className="modal-subtitle">
                  Import ride data from Strava, Garmin, or Suunto
                </p>
              </div>
              <button className="modal-close" onClick={closeGpxModal} aria-label="Close">
                ×
              </button>
            </div>

            <label className="file-drop-zone">
              <input
                type="file"
                accept=".gpx"
                className="file-input"
                onChange={(e) => handleGpxFile(e.target.files?.[0])}
              />
              <div className="file-drop-content">
                <svg className="file-icon" width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 5v14m0-14 4 4m-4-4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M6 13v5h12v-5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="file-label">{gpxFileName || 'Drop your GPX file here'}</span>
                <span className="file-hint">or click to browse your files</span>
              </div>
            </label>

            <div className="modal-field">
              <label className="field-label">Assign to Bike</label>
              <select
                className="field-select"
                value={gpxBikeId}
                onChange={(e) => setGpxBikeId(e.target.value)}
              >
                {bikesRaw.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {bike.nickname || `${bike.manufacturer} ${bike.model}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" type="button" onClick={closeGpxModal}>
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-submit"
                type="button"
                onClick={handleGpxSubmit}
                disabled={!gpxFileName || !gpxBikeId}
              >
                Upload & Import
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
