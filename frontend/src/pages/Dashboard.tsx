// src/pages/Dashboard.tsx
import { Link } from "react-router-dom";
import { useQuery } from "@apollo/client";
import { RIDES } from "../graphql/rides";
import RideCard from "../components/RideCard";
import BikeCard from "../components/BikeCard";
import RideStatsCard from "../components/RideStatsCard.tsx";
import { BIKES } from "../graphql/bikes.ts";

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

export default function Dashboard() {
  const { data, loading, error } = useQuery<{ rides: Ride[] }>(RIDES, {
    variables: { take: RECENT_COUNT },
    fetchPolicy: "cache-first",
  });

  const {
    data: bikesData,
    loading: bikesLoading,
    error: bikesError,
  } = useQuery(BIKES);
  const bikes = bikesData?.bikes ?? [];

  const rides = data?.rides ?? [];

  return (
    <div className="bg-app p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">LoamLogger Dashboard</h1>
        <Link
          to="/"
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Log out
        </Link>
      </header>

      {/* Welcome */}
      <section className="mb-6">
        <p className="text-lg text-accent-contrast">
          Welcome back! Here's a quick look at your mountain biking activity and
          gear status.
        </p>
      </section>

      {/* Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Recent Rides */}
        <div className="bg-surface border rounded-md shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold">Recent Rides</h2>
            <Link
              to="/rides"
              className="text-sm underline text-gray-600 hover:text-gray-800"
            >
              View all
            </Link>
          </div>

          {loading && (
            <div className="space-y-3">
              <div className="h-16 rounded-md bg-gray-100 animate-pulse" />
              <div className="h-16 rounded-md bg-gray-100 animate-pulse" />
              <div className="h-16 rounded-md bg-gray-100 animate-pulse" />
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600">
              Couldn’t load rides. {error.message}
            </div>
          )}

          {!loading && !error && rides.length === 0 && (
            <div className="text-sm text-gray-600">
              No rides yet.{" "}
              <Link to="/rides" className="underline">
                Add your first ride
              </Link>
              .
            </div>
          )}

          {!loading && !error && rides.length > 0 && (
            <ul className="space-y-3">
              {rides.map((ride) => (
                <RideCard key={ride.id} ride={ride} />
              ))}
            </ul>
          )}
        </div>

        {/* Ride Stats */}
        <div className="bg-surface border rounded-md shadow p-4 w-full">
          <RideStatsCard />
        </div>

        {/* Gear Summary */}
        <div className="bg-surface border rounded-md shadow p-4 w-full">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold">Bike / Gear Tracker</h2>
            <a href="/bikes" className="text-sm text-accent underline">
              Manage
            </a>
          </div>

          {bikesLoading && (
            <div className="p-4 space-y-3">
              <div className="h-20 rounded bg-surface-2 animate-pulse" />
              <div className="h-20 rounded bg-surface-2 animate-pulse" />
            </div>
          )}

          {bikesError && (
            <div
              className="p-4 text-sm"
              style={{ color: "rgb(var(--danger))" }}
            >
              Failed to load bikes: {bikesError.message}
            </div>
          )}

          {!bikesLoading && !bikesError && bikes.length === 0 && (
            <div className="p-4 text-sm text-muted">
              No bikes yet. Head to{" "}
              <a className="underline" href="/bikes">
                Bike Garage
              </a>{" "}
              to add one.
            </div>
          )}

          {!bikesLoading && !bikesError && bikes.length > 0 && (
            <div className="p-4 grid gap-3">
              {bikes.map((bike: any) => (
                <BikeCard key={bike.id} bike={bike} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
