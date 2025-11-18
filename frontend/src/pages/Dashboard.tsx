// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';
import RideCard from '../components/RideCard';
import BikeCard from '../components/BikeCard';
import RideStatsCard from '../components/RideStatsCard.tsx';
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
  const name = (bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim()) || 'Bike';

  return {
    id: bike.id,
    name,
    type: 'trail',
    frameMaterial: 'carbon',
    travelFrontMm: ensureNumber(bike.travelForkMm),
    travelRearMm: ensureNumber(bike.travelShockMm),
    fork: {
      brand: bike.fork?.brand ?? 'Fork',
      model: bike.fork?.model ?? 'Stock',
      travelMm: ensureNumber(bike.travelForkMm),
      hoursSinceLastService: ensureNumber(bike.fork?.hoursUsed),
      offsetMm: undefined,
      damper: undefined,
    },
    shock: {
      brand: bike.shock?.brand ?? 'Shock',
      model: bike.shock?.model ?? 'Stock',
      strokeMm: ensureNumber(bike.travelShockMm),
      eyeToEyeMm: 0,
      hoursSinceLastService: ensureNumber(bike.shock?.hoursUsed),
      type: 'air',
    },
    drivetrain: {
      brand: drivetrain?.brand ?? 'Stock',
      speed: 12,
      cassetteRange: drivetrain?.model ?? 'N/A',
      derailleur: drivetrain?.model ?? 'N/A',
      shifter: drivetrain?.model ?? 'N/A',
      hoursSinceLastService: ensureNumber(drivetrain?.hoursUsed),
    },
    hoursSinceLastService: ensureNumber(bike.pivotBearings?.hoursUsed),
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

  const rides = ridesData?.rides ?? [];
  const bikesRaw = bikesData?.bikes ?? [];
  const userBikes = useMemo(
    () => (bikesData?.bikes ?? []).map((bike) => toBikeCardModel(bike)),
    [bikesData]
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
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-muted">Ride statistics</p>
                <h3 className="text-2xl font-semibold text-white">How you're trending</h3>
              </div>
            </div>
            <RideStatsCard showHeading={false} />
          </div>

          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
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
                  <RideCard key={ride.id} ride={ride} />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 h-fit">
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
        </div>
      </section>

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
    </div>
  );
}
