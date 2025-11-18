// src/pages/Rides.tsx
import { useQuery } from "@apollo/client";
import { Link } from "react-router-dom";
import AddRideForm from "../components/AddRideForm";
import RideCard from "../components/RideCard";
import { RIDES } from '../graphql/rides';

type Ride = {
  id: string;
  startTime: string | number;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
};

export default function RidesPage() {
  const { data, refetch, loading, error } = useQuery<{ rides: Ride[] }>(RIDES, {
    fetchPolicy: 'cache-and-network',
  });
  const rides = data?.rides ?? [];

  return (
    <div className="space-y-6">
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Ride log</p>
            <h2 className="text-2xl font-semibold text-white">Log manual rides or sync later</h2>
            <p className="text-sm text-muted">
              Upload from devices or enter by hand to keep your service hours accurate.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-outline text-sm px-4 py-2"
            type="button"
          >
            Refresh
          </button>
        </div>
        <AddRideForm onAdded={() => refetch()} />
      </section>

      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Ride history</p>
            <h3 className="text-xl font-semibold text-white">All rides</h3>
          </div>
          <Link to="/gear" className="text-sm text-muted underline hover:text-primary">
            Assign bikes
          </Link>
        </div>

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-20 rounded-2xl bg-surface-2/80 animate-pulse" />
            ))}
          </div>
        )}

        {error && <div className="text-sm text-danger">Couldn't load rides. {error.message}</div>}

        {!loading && !error && rides.length === 0 && (
          <div className="rounded-xl border border-dashed border-app/50 px-4 py-6 text-center text-sm text-muted">
            No rides logged yet. Start with the form above or{' '}
            <span className="text-accent">connect your Garmin account in Settings.</span>
          </div>
        )}

        {!loading && !error && rides.length > 0 && (
          <ul className="grid gap-3">
            {rides.map((ride: Ride) => (
              <RideCard key={ride.id} ride={ride} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
