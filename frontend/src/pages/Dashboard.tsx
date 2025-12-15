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
    pollInterval: 60000, // Check every minute
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

  // TEMPORARY: Simulate Garmin ride webhook for testing
  const handleSimulateGarminRide = async () => {
    if (bikesRaw.length === 0) {
      alert('Please add a bike first to test Garmin rides.');
      return;
    }

    setIsSimulatingRide(true);
    try {
      // Generate mock Garmin ride data
      const now = new Date();
      const mockRideData = {
        startTime: now.toISOString(),
        durationSeconds: Math.floor(Math.random() * 3600) + 1800, // 30-90 min
        distanceMiles: parseFloat((Math.random() * 15 + 5).toFixed(2)), // 5-20 miles
        elevationGainFeet: Math.floor(Math.random() * 2000) + 500, // 500-2500 ft
        averageHr: Math.floor(Math.random() * 40) + 140, // 140-180 bpm
        rideType: 'TRAIL',
        // Don't pass bikeId - let backend auto-assign for single bike, or leave unassigned for multi-bike
        notes: '🧪 TEST: Simulated Garmin ride from watch',
        trailSystem: 'Mock Trail System',
        location: 'Test Location',
      };

      await addRide({
        variables: { input: mockRideData },
      });

      // Refetch rides to show the new one
      await refetchRides();

      alert('✅ Simulated Garmin ride created successfully!');
    } catch (err) {
      console.error('Failed to simulate Garmin ride:', err);
      alert('❌ Failed to simulate ride. Check console for details.');
    } finally {
      setIsSimulatingRide(false);
    }
  };

  // TEMPORARY: Simulate a long 50+ hour Garmin ride for testing
  const handleSimulateLongGarminRide = async () => {
    if (bikesRaw.length === 0) {
      alert('Please add a bike first to test Garmin rides.');
      return;
    }

    setIsSimulatingRide(true);
    try {
      // Generate mock long Garmin ride data (50+ hours)
      const now = new Date();
      const mockRideData = {
        startTime: now.toISOString(),
        durationSeconds: Math.floor(Math.random() * 36000) + 180000, // 50-60 hours
        distanceMiles: parseFloat((Math.random() * 200 + 300).toFixed(2)), // 300-500 miles
        elevationGainFeet: Math.floor(Math.random() * 20000) + 30000, // 30000-50000 ft
        averageHr: Math.floor(Math.random() * 40) + 140, // 140-180 bpm
        rideType: 'TRAIL',
        // Don't pass bikeId - let backend auto-assign for single bike, or leave unassigned for multi-bike
        notes: '🧪 TEST: Simulated LONG Garmin ride from watch (50+ hours)',
        trailSystem: 'Epic Long Trail System',
        location: 'Test Location',
      };

      await addRide({
        variables: { input: mockRideData },
      });

      // Refetch rides to show the new one
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
    <div className="space-y-8">
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Ride overview</p>
            <h2 className="text-3xl font-semibold text-white">
              Dialed in, {firstName}. Keep the streak going.
            </h2>
            <p className="text-muted text-base max-w-xl">
              Your latest rides, service hours, and equipment health are all synced below.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/rides" className="btn-primary text-sm px-5 py-2">
              Log Ride
            </Link>
            <button
              type="button"
              className="btn-secondary text-sm px-5 py-2"
              onClick={() => setGpxModalOpen(true)}
            >
              Upload GPX
            </button>
            <Link to="/gear" className="btn-secondary text-sm px-5 py-2">
              Manage Bikes
            </Link>
            {/* TEMPORARY: Test button for Garmin webhook simulation */}
            <button
              type="button"
              className="text-sm px-5 py-2 rounded-2xl border-2 border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 hover:border-yellow-500/70 transition font-semibold"
              onClick={handleSimulateGarminRide}
              disabled={isSimulatingRide}
            >
              {isSimulatingRide ? '⏳ Simulating...' : '🧪 TEST: Simulate Garmin Ride'}
            </button>
            {/* TEMPORARY: Test button for long Garmin ride simulation */}
            <button
              type="button"
              className="text-sm px-5 py-2 rounded-2xl border-2 border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 hover:border-orange-500/70 transition font-semibold"
              onClick={handleSimulateLongGarminRide}
              disabled={isSimulatingRide}
            >
              {isSimulatingRide ? '⏳ Simulating...' : '🧪 TEST: Simulate Long Garmin Ride'}
            </button>
          </div>
        </div>
      </section>

      {/* Single Column Layout: Service Radar, Ride Statistics, Recent Rides */}
      <div className="space-y-6">
        {/* Service Radar */}
        <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Bike / Gear</p>
              <h3 className="text-2xl font-semibold text-white">Service radar</h3>
            </div>
            <Link to="/gear" className="btn-outline text-sm px-4 py-2">
              Garage
            </Link>
          </div>

          <div className="space-y-5">
            {bikesLoading && (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, idx) => (
                  <div key={idx} className="h-28 rounded-2xl bg-surface-2/80 animate-pulse" />
                ))}
              </div>
            )}
            {bikesError && (
              <div className="text-sm text-danger">
                Couldn't load bikes. {bikesError.message}
              </div>
            )}
            {!bikesLoading && !bikesError && userBikes.length === 0 && (
              <div className="rounded-xl border border-dashed border-app/50 px-4 py-6 text-sm text-muted text-center">
                No bikes yet.{' '}
                <Link to="/gear" className="link-accent underline">
                  Manage your garage
                </Link>
                .
              </div>
            )}
            {userBikes.map((bike) => (
              <BikeCard key={bike.id} bike={bike} />
            ))}
          </div>
        </section>

        {/* Ride Statistics */}
        <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Ride statistics</p>
              <h3 className="text-2xl font-semibold text-white">How you're trending</h3>
            </div>
          </div>
          <RideStatsCard showHeading={false} />
        </section>

        {/* Trail Log */}
        <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">Recent rides</p>
              <h3 className="text-2xl font-semibold text-white">Trail log</h3>
            </div>
            <Link to="/rides" className="btn-outline text-sm px-4 py-2">
              View all
            </Link>
          </div>

          {ridesLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-20 rounded-2xl bg-surface-2/80 animate-pulse" />
              ))}
            </div>
          )}

          {ridesError && (
            <div className="text-sm text-danger">
              Couldn't load rides. {ridesError.message}
            </div>
          )}

          {!ridesLoading && !ridesError && rides.length === 0 && (
            <div className="rounded-xl border border-dashed border-app/50 px-4 py-6 text-sm text-muted text-center">
              No rides yet.{' '}
              <Link to="/rides" className="link-accent underline">
                Add your first ride
              </Link>
              .
            </div>
          )}

          {!ridesLoading && !ridesError && rides.length > 0 && (
            <ul className="space-y-3">
              {rides.map((ride) => (
                <RideCard key={ride.id} ride={ride} bikes={bikesRaw} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {gpxModalOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6"
          onClick={closeGpxModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-3xl panel-soft modal-surface shadow-soft p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-semibold">Upload GPX File</h3>
                <p className="text-sm text-muted">
                  Import ride data from Strava, Garmin, or Suunto and align it to a bike.
                </p>
              </div>
              <button className="text-2xl text-muted" onClick={closeGpxModal} aria-label="Close">
                ×
              </button>
            </div>

            <label className="block rounded-2xl border border-dashed border-app/60 bg-surface-2/70 px-4 py-12 text-center text-sm text-muted cursor-pointer">
              <input
                type="file"
                accept=".gpx"
                className="hidden"
                onChange={(e) => handleGpxFile(e.target.files?.[0])}
              />
              <div className="flex flex-col items-center gap-2">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
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
                <span className="font-semibold">{gpxFileName || 'Drop GPX file here'}</span>
                <span className="text-xs text-muted">or click to browse</span>
              </div>
            </label>

            <div className="mt-4">
              <label className="text-xs uppercase tracking-[0.3em] text-muted">Assign to Bike</label>
              <select
                className="mt-2 w-full rounded-2xl border border-app/60 bg-surface-2/70 px-3 py-2 text-sm"
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

            <div className="mt-6 flex justify-end gap-3">
              <button className="btn-secondary" type="button" onClick={closeGpxModal}>
                Cancel
              </button>
              <button
                className="btn-primary"
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
