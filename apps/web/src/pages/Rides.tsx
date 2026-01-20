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

  const now = new Date();

  // End date: end of today (23:59:59.999)
  const endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);

  // Start date: beginning of the day N days/months/years ago (00:00:00.000)
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  switch (range) {
    case '30days':
      startDate.setDate(startDate.getDate() - 30);
      break;
    case '3months':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6months':
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case '1year':
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
  }

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
};

export default function RidesPage() {
  const [dateRange, setDateRange] = useState<DateRange>('30days');

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
    <div className="page-container space-y-6">
      <section className="panel">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Ride log</p>
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

      <section className="panel">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Ride history</p>
            <h3 className="title-section">All rides</h3>
          </div>
          <Link to="/gear" className="text-sm text-muted underline hover:text-primary">
            Assign bikes
          </Link>
        </div>

        <div className="mb-4 p-4 rounded-2xl bg-surface-2/50 border border-app/50">
          <p className="label-section mb-3">Filter by date</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="radio"
                name="dateRange"
                checked={dateRange === '30days'}
                onChange={() => setDateRange('30days')}
                className="w-4 h-4 border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last 30 days</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="radio"
                name="dateRange"
                checked={dateRange === '3months'}
                onChange={() => setDateRange('3months')}
                className="w-4 h-4 border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last 3 months</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="radio"
                name="dateRange"
                checked={dateRange === '6months'}
                onChange={() => setDateRange('6months')}
                className="w-4 h-4 border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last 6 months</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="radio"
                name="dateRange"
                checked={dateRange === '1year'}
                onChange={() => setDateRange('1year')}
                className="w-4 h-4 border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>Last year</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors">
              <input
                type="radio"
                name="dateRange"
                checked={dateRange === 'all'}
                onChange={() => setDateRange('all')}
                className="w-4 h-4 border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
              />
              <span>All time</span>
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
