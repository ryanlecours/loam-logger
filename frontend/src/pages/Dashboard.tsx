// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import { ADD_RIDE } from '../graphql/addRide';
import { UNMAPPED_STRAVA_GEARS } from '../graphql/stravaGear';
import RideCard from '../components/RideCard';
import BikeCard from '../components/BikeCard';
import RideStatsCard from '../components/RideStatsCard.tsx';
import StravaGearMappingModal from '../components/StravaGearMappingModal';
import { useCurrentUser } from '../hooks/useCurrentUser.ts';
import type { Bike } from '../models/BikeComponents';


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

type ComponentSummary = {
  id: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

type BikeSummary = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  notes?: string | null;
  fork?: ComponentSummary | null;
  shock?: ComponentSummary | null;
  pivotBearings?: ComponentSummary | null;
  components: ComponentSummary[];
};

const ensureNumber = (value?: number | null, fallback = 0) =>
  typeof value === 'number' ? value : fallback;

const toBikeCardModel = (bike: BikeSummary): Bike => {
  const drivetrain =
    bike.components?.find((component) => component.type === 'DRIVETRAIN') ?? null;
  const wheels =
    bike.components?.find((component) => component.type === 'WHEELS') ?? null;
  const dropper =
    bike.components?.find((component) => component.type === 'DROPPER') ?? null;
  const name = (bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim()) || 'Bike';

  return {
    id: bike.id,
    name,
    type: 'trail',
    frameMaterial: 'carbon',
    travelFrontMm: ensureNumber(bike.travelForkMm),
    travelRearMm: ensureNumber(bike.travelShockMm),
    fork: {
      id: bike.fork?.id,
      brand: bike.fork?.brand ?? 'Fork',
      model: bike.fork?.model ?? 'Stock',
      travelMm: ensureNumber(bike.travelForkMm),
      hoursSinceLastService: ensureNumber(bike.fork?.hoursUsed),
      offsetMm: undefined,
      damper: undefined,
    },
    shock: {
      id: bike.shock?.id,
      brand: bike.shock?.brand ?? 'Shock',
      model: bike.shock?.model ?? 'Stock',
      strokeMm: ensureNumber(bike.travelShockMm),
      eyeToEyeMm: 0,
      hoursSinceLastService: ensureNumber(bike.shock?.hoursUsed),
      type: 'air',
    },
    drivetrain: {
      id: drivetrain?.id,
      brand: drivetrain?.brand ?? 'Stock',
      speed: 12,
      cassetteRange: drivetrain?.model ?? 'N/A',
      derailleur: drivetrain?.model ?? 'N/A',
      shifter: drivetrain?.model ?? 'N/A',
      hoursSinceLastService: ensureNumber(drivetrain?.hoursUsed),
    },
    wheelBearings: {
      id: wheels?.id,
      brand: wheels?.brand ?? 'Stock',
      model: wheels?.model ?? 'Wheels',
      hoursSinceLastService: ensureNumber(wheels?.hoursUsed),
    },
    dropperPost: {
      id: dropper?.id,
      brand: dropper?.brand ?? 'Stock',
      model: dropper?.model ?? 'Dropper',
      hoursSinceLastService: ensureNumber(dropper?.hoursUsed),
    },
    hoursSinceLastService: ensureNumber(bike.pivotBearings?.hoursUsed),
    pivotBearingsId: bike.pivotBearings?.id,
    notes: bike.notes ?? undefined,
  };
};

const RECENT_COUNT = 5;

export default function Dashboard() {
  const user = useCurrentUser().user;
  const firstName = user?.name?.split(' ')?.[0] ?? 'Rider';
  const {
    data: ridesData,
    loading: ridesLoading,
    error: ridesError,
    refetch: refetchRides,
  } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: { take: RECENT_COUNT },
    fetchPolicy: 'cache-first',
  });
  const {
    data: bikesData,
    loading: bikesLoading,
    error: bikesError,
  } = useQuery<{ bikes: BikeSummary[] }>(BIKES, {
    fetchPolicy: 'cache-and-network',
  });

  const [addRide] = useMutation(ADD_RIDE);
  const [isSimulatingRide, setIsSimulatingRide] = useState(false);

  const [showGearMapping, setShowGearMapping] = useState(false);
  const [unmappedGears, setUnmappedGears] = useState<Array<{ gearId: string; rideCount: number }>>([]);

  const { data: unmappedData } = useQuery(UNMAPPED_STRAVA_GEARS, {
    pollInterval: 60000,
    skip: !user,
  });

  useEffect(() => {
    if (unmappedData?.unmappedStravaGears?.length > 0) {
      setUnmappedGears(unmappedData.unmappedStravaGears);
      setShowGearMapping(true);
    }
  }, [unmappedData]);

  const rides = ridesData?.rides ?? [];
  const bikesRaw = useMemo(() => bikesData?.bikes ?? [], [bikesData]);
  const userBikes = useMemo(
    () => bikesRaw.map((bike) => toBikeCardModel(bike)),
    [bikesRaw]
  );
  const [gpxModalOpen, setGpxModalOpen] = useState(false);
  const [gpxBikeId, setGpxBikeId] = useState<string>('');
  const [gpxFileName, setGpxFileName] = useState<string>('');

  useEffect(() => {
    if (!gpxBikeId && bikesRaw.length > 0) {
      setGpxBikeId(bikesRaw[0].id);
    }
  }, [bikesRaw, gpxBikeId]);

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
        notes: '🧪 TEST: Simulated Garmin ride from watch',
        trailSystem: 'Mock Trail System',
        location: 'Test Location',
      };

      await addRide({
        variables: { input: mockRideData },
      });

      await refetchRides();
      alert('✅ Simulated Garmin ride created successfully!');
    } catch (err) {
      console.error('Failed to simulate Garmin ride:', err);
      alert('❌ Failed to simulate ride. Check console for details.');
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
        notes: '🧪 TEST: Simulated LONG Garmin ride from watch (50+ hours)',
        trailSystem: 'Epic Long Trail System',
        location: 'Test Location',
      };

      await addRide({
        variables: { input: mockRideData },
      });

      await refetchRides();
      alert('✅ Simulated long Garmin ride created successfully!');
    } catch (err) {
      console.error('Failed to simulate long Garmin ride:', err);
      alert('❌ Failed to simulate ride. Check console for details.');
    } finally {
      setIsSimulatingRide(false);
    }
  };

  return (
    <div className="dashboard-app">
      {/* Hero Welcome Section */}
      <section className="dashboard-hero">
        <div className="hero-greeting-badge">
          <span className="greeting-dot" />
          Welcome Back
        </div>
        <h1 className="hero-title">
          Everything looks good, <span className="hero-name">{firstName}</span>.
        </h1>
        <p className="hero-subtitle">
          Your bikes are maintained, your rides are logged, and your components are tracked.
          <span className="hero-subtitle-highlight"> Let's keep the momentum going.</span>
        </p>
        <div className="hero-actions">
          <Link to="/rides" className="action-btn action-btn-primary">
            Log New Ride
          </Link>
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={() => setGpxModalOpen(true)}
          >
            Upload GPX
          </button>
          <Link to="/gear" className="action-btn action-btn-outline">
            View Garage
          </Link>
        </div>

        {/* Test buttons */}
        <div className="dev-actions">
          <button
            type="button"
            className="dev-btn"
            onClick={handleSimulateGarminRide}
            disabled={isSimulatingRide}
          >
            {isSimulatingRide ? '⏳ Simulating' : '🧪 Test Ride'}
          </button>
          <button
            type="button"
            className="dev-btn"
            onClick={handleSimulateLongGarminRide}
            disabled={isSimulatingRide}
          >
            {isSimulatingRide ? '⏳ Simulating' : '🧪 Long Ride'}
          </button>
        </div>
      </section>

      {/* Dashboard Grid - Asymmetric Flow */}
      <div className="dashboard-grid">
        {/* Service Overview - Large Featured Card */}
        <section className="data-card data-card-primary card-service">
          <div className="card-header">
            <div className="card-label-group">
              <span className="card-eyebrow">Component Health</span>
              <h2 className="card-title">Service Overview</h2>
              <span className="card-count">{userBikes.length} {userBikes.length === 1 ? 'bike' : 'bikes'} tracked</span>
            </div>
            <Link to="/gear" className="card-action-link">
              View All →
            </Link>
          </div>

          <div>
            {bikesLoading && (
              <div className="loading-state">
                {Array.from({ length: 2 }).map((_, idx) => (
                  <div key={idx} className="skeleton-item" />
                ))}
              </div>
            )}
            {bikesError && (
              <div className="error-state">
                <span className="error-icon">⚠️</span>
                <p className="error-text">
                  Unable to load bikes: {bikesError.message}
                </p>
              </div>
            )}
            {!bikesLoading && !bikesError && userBikes.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">🚵</span>
                <p className="empty-text">
                  No bikes in your garage yet.{' '}
                  <Link to="/gear" className="empty-link">
                    Add your first bike
                  </Link>
                  {' '}to start tracking components.
                </p>
              </div>
            )}
            {!bikesLoading && !bikesError && userBikes.length > 0 && (
              <div className="item-list">
                {userBikes.map((bike, idx) => (
                  <div key={bike.id} className="list-item" style={{ animationDelay: `${idx * 0.1}s` }}>
                    <BikeCard bike={bike} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Ride Statistics - Elevated Data Card */}
        <section className="data-card data-card-secondary card-stats">
          <div className="card-header">
            <div className="card-label-group">
              <span className="card-eyebrow">Performance</span>
              <h2 className="card-title">Ride Stats</h2>
            </div>
          </div>
          <div>
            <RideStatsCard showHeading={false} />
          </div>
        </section>

        {/* Trail Log - Recent Activity */}
        <section className="data-card data-card-tertiary card-trail-log">
          <div className="card-header">
            <div className="card-label-group">
              <span className="card-eyebrow">Recent Activity</span>
              <h2 className="card-title">Trail Log</h2>
              <span className="card-count">{rides.length} of last {RECENT_COUNT}</span>
            </div>
            <Link to="/rides" className="card-action-link">
              View All →
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
                <span className="error-icon">⚠️</span>
                <p className="error-text">
                  Unable to load rides: {ridesError.message}
                </p>
              </div>
            )}

            {!ridesLoading && !ridesError && rides.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">🏔️</span>
                <p className="empty-text">
                  No rides recorded yet.{' '}
                  <Link to="/rides" className="empty-link">
                    Log your first ride
                  </Link>
                  {' '}to start tracking your adventures.
                </p>
              </div>
            )}

            {!ridesLoading && !ridesError && rides.length > 0 && (
              <ul className="item-list">
                {rides.map((ride, idx) => (
                  <li key={ride.id} className="list-item" style={{ animationDelay: `${idx * 0.08}s` }}>
                    <RideCard ride={ride} bikes={bikesRaw} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* GPX Upload Modal */}
      {gpxModalOpen && (
        <div
          className="modal-overlay"
          onClick={closeGpxModal}
        >
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
