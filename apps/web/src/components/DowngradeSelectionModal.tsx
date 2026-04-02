import { gql, useQuery, useMutation } from '@apollo/client';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { ME_QUERY } from '../graphql/me';

const BIKES_QUERY = gql`
  query BikesForDowngrade {
    bikes(includeInactive: false) {
      id
      nickname
      manufacturer
      model
      year
      thumbnailUrl
    }
  }
`;

const SELECT_BIKE = gql`
  mutation SelectBikeForDowngrade($bikeId: ID!) {
    selectBikeForDowngrade(bikeId: $bikeId) {
      id
    }
  }
`;

export default function DowngradeSelectionModal() {
  const { data } = useQuery(BIKES_QUERY);
  const [selectBike, { loading }] = useMutation(SELECT_BIKE, {
    refetchQueries: [{ query: ME_QUERY }, { query: BIKES_QUERY }],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bikes = data?.bikes ?? [];

  const handleConfirm = async () => {
    if (!selectedId) return;
    await selectBike({ variables: { bikeId: selectedId } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-app/60 bg-surface-1 p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          <h2 className="text-lg font-semibold text-white">Select a bike to keep</h2>
        </div>

        <p className="text-sm text-muted mb-4">
          Your Pro subscription has ended. Please select one bike to continue maintaining.
          Other bikes will be archived and can be restored if you re-subscribe.
        </p>

        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {bikes.map((bike: { id: string; nickname?: string; manufacturer: string; model: string; year?: number; thumbnailUrl?: string }) => (
            <label
              key={bike.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                selectedId === bike.id
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-app/40 bg-surface-2 hover:border-app/60'
              }`}
            >
              <input
                type="radio"
                name="bike-select"
                value={bike.id}
                checked={selectedId === bike.id}
                onChange={() => setSelectedId(bike.id)}
                className="accent-primary"
              />
              {bike.thumbnailUrl && (
                <img src={bike.thumbnailUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
              )}
              <div>
                <p className="text-sm font-medium text-white">
                  {bike.nickname || `${bike.manufacturer} ${bike.model}`}
                </p>
                {bike.nickname && (
                  <p className="text-xs text-muted">
                    {bike.manufacturer} {bike.model} {bike.year && `(${bike.year})`}
                  </p>
                )}
              </div>
            </label>
          ))}
        </div>

        <button
          onClick={handleConfirm}
          disabled={!selectedId || loading}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Keep this bike'}
        </button>
      </div>
    </div>
  );
}
