// src/pages/Bikes.tsx
import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { BIKES } from '../graphql/bikes';
import BikeCard from '../components/BikeCard';
import AddBikeModal from '../components/AddBikeModal';

type Component = {
  id: string;
  type: 'FORK' | 'SHOCK' | 'WHEELSET' | 'DROPPERPOST';
  manufacturer: string;
  model: string;
  year?: number | null;
  hoursSinceService: number;
  lastServicedAt?: string | null;
};

type Bike = {
  id: string;
  manufacturer: string;
  model: string;
  nickname?: string | null;
  pivotHoursSinceService: number;
  pivotLastServicedAt?: string | null;
  isComplete: boolean;
  components: Component[];
};

export default function Bikes() {
  const { data, loading, error } = useQuery<{ bikes: Bike[] }>(BIKES);
  const [adding, setAdding] = useState(false);

  const bikes = data?.bikes ?? [];

  return (
    <div className="bg-app p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <h1 className="text-3xl text-heading">Bike Garage</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          Add a Bike
        </button>
      </header>

      {/* List */}
      <section className="bg-surface border border-app rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">All Bikes</h2>
          {!loading && !error && (
            <span className="text-sm text-muted">{bikes.length} total</span>
          )}
        </div>

        {loading && (
          <div className="grid gap-2">
            <div className="h-16 rounded bg-surface-2 animate-pulse" />
            <div className="h-16 rounded bg-surface-2 animate-pulse" />
            <div className="h-16 rounded bg-surface-2 animate-pulse" />
          </div>
        )}

        {error && (
          <div className="text-sm" style={{ color: 'rgb(var(--danger))' }}>
            Failed to load bikes: {error.message}
          </div>
        )}

        {!loading && !error && bikes.length === 0 && (
          <div className="text-muted text-sm">
            No bikes yet. Click <b>Add a Bike</b> to get started.
          </div>
        )}

        {!loading && !error && bikes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bikes.map((b) => (
              <BikeCard key={b.id} bike={b} />
            ))}
          </div>
        )}
      </section>

      {adding && <AddBikeModal onClose={() => setAdding(false)} />}
    </div>
  );
}
