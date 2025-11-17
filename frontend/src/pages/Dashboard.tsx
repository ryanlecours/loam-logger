// src/pages/Dashboard.tsx
import { useMemo } from 'react';
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
  const userBikes = useMemo(
    () => (bikesData?.bikes ?? []).map((bike) => toBikeCardModel(bike)),
    [bikesData]
  );

  return (
    <div className="min-h-screen bg-app p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-12">
        <h1 className="text-3xl font-bold">LoamLogger Dashboard</h1>
      </header>

      {/* Welcome */}
      <section className="mb-6">
        <p className="text-lg text-accent-contrast">
          Welcome back {user.name.split(' ').slice(0, -1).join(' ')}! Here's a quick look at your mountain biking activity and gear status.
        </p>
      </section>

      {/* Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Recent Rides */}
        <div className="bg-surface border rounded-md shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold">Recent Rides</h2>
            <Link to="/rides" className="link-accent-contrast link-accent:hover">
              View all
            </Link>
          </div>

          {ridesLoading && (
            <div className="space-y-3">
              <div className="h-16 rounded-md bg-gray-100 animate-pulse" />
              <div className="h-16 rounded-md bg-gray-100 animate-pulse" />
              <div className="h-16 rounded-md bg-gray-100 animate-pulse" />
            </div>
          )}

          {ridesError && (
            <div className="text-sm text-red-600">
              Couldn't load rides. {ridesError.message}
            </div>
          )}

          {!ridesLoading && !ridesError && rides.length === 0 && (
            <div className="text-sm text-gray-600">
              No rides yet. <Link to="/rides" className="underline">Add your first ride</Link>.
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

        {/* Ride Stats */}
        <div className="bg-surface border rounded-md shadow p-4 w-full">
          <RideStatsCard />
        </div>

        {/* Gear Summary */}
        <div className="bg-surface border rounded-md shadow p-4 w-full">
          <h2 className="text-xl font-semibold mb-2">Bike / Gear Tracker</h2>
          <div className="p-4 space-y-6">
            {bikesLoading && (
              <div className="space-y-3">
                <div className="h-32 rounded-md bg-gray-100 animate-pulse" />
                <div className="h-32 rounded-md bg-gray-100 animate-pulse" />
              </div>
            )}
            {bikesError && (
              <div className="text-sm text-red-600">
                Couldn't load bikes. {bikesError.message}
              </div>
            )}
            {!bikesLoading && !bikesError && userBikes.length === 0 && (
              <div className="text-sm text-gray-600">
                No bikes yet.{' '}
                <Link to="/gear" className="underline">
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
    </div>
  );
}
