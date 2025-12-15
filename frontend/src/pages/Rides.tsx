// src/pages/Rides.tsx
import { useQuery } from "@apollo/client";
import { Link } from "react-router-dom";
import { useState } from "react";
import AddRideForm from "../components/AddRideForm";
import RideCard from "../components/RideCard";
import { RIDES } from '../graphql/rides';
import { BIKES } from '../graphql/bikes';

type Ride = {
  id: string;
  garminActivityId?: string | null;
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

type Bike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

type DateRange = 'all' | '30days' | '3months' | '6months' | '1year';

const getDateRangeFilter = (range: DateRange) => {
  if (range === 'all') return null;

  const endDate = new Date();
  const startDate = new Date();

  switch (range) {
    case '30days':
      startDate.setDate(endDate.getDate() - 30);
      break;
    case '3months':
      startDate.setMonth(endDate.getMonth() - 3);
      break;
    case '6months':
      startDate.setMonth(endDate.getMonth() - 6);
      break;
    case '1year':
      startDate.setFullYear(endDate.getFullYear() - 1);
      break;
  }

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
};

export default function RidesPage() {
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const { data, refetch, loading, error } = useQuery<{ rides: Ride[] }>(RIDES, {
    fetchPolicy: 'cache-and-network',
    variables: {
      filter: getDateRangeFilter(dateRange),
    },
  });
  const { data: bikesData } = useQuery<{ bikes: Bike[] }>(BIKES, {
    fetchPolicy: 'cache-and-network',
  });
  const rides = data?.rides ?? [];
  const bikes = bikesData?.bikes ?? [];

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

        <div className="mb-4 p-4 rounded-2xl bg-surface-2/50 border border-app/50">
          <p className="text-xs uppercase tracking-[0.3em] text-muted mb-3">Filter by date</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="checkbox"
                checked={dateRange === 'all'}
                onChange={() => setDateRange('all')}
                className="w-4 h-4 rounded border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>All time</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="checkbox"
                checked={dateRange === '30days'}
                onChange={() => setDateRange('30days')}
                className="w-4 h-4 rounded border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last 30 days</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="checkbox"
                checked={dateRange === '3months'}
                onChange={() => setDateRange('3months')}
                className="w-4 h-4 rounded border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last 3 months</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="checkbox"
                checked={dateRange === '6months'}
                onChange={() => setDateRange('6months')}
                className="w-4 h-4 rounded border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last 6 months</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="checkbox"
                checked={dateRange === '1year'}
                onChange={() => setDateRange('1year')}
                className="w-4 h-4 rounded border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last year</span>
            </label>
          </div>
          {dateRange !== 'all' && (
            <p className="mt-3 text-xs text-muted">
              Showing {rides.length} ride{rides.length !== 1 ? 's' : ''} in selected range
            </p>
          )}
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
              <RideCard key={ride.id} ride={ride} bikes={bikes} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
