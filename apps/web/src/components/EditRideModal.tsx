import { useState, useMemo } from 'react';
import { useMutation } from '@apollo/client';
import { UPDATE_RIDE } from '../graphql/updateRide';
import { RIDES } from '../graphql/rides';
import { toLocalInputValue, fromLocalInputValue } from '../lib/format';

type Ride = {
  id: string;
  startTime: string | number | Date;
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

export default function EditRideModal({
  ride,
  onClose,
}: {
  ride: Ride;
  onClose: () => void;
}) {
  // Pre-fill fields
  const [startLocal, setStartLocal] = useState<string>(() => toLocalInputValue(ride.startTime));
  const [hours, setHours] = useState<number>(() => Math.floor(ride.durationSeconds / 3600));
  const [minutes, setMinutes] = useState<number>(() => Math.round((ride.durationSeconds % 3600) / 60));
  const [distanceMiles, setDistanceMiles] = useState<number>(ride.distanceMiles);
  const [elevationGainFeet, setElevationGainFeet] = useState<number>(ride.elevationGainFeet);
  const [averageHr, setAverageHr] = useState<number | ''>(ride.averageHr ?? '');
  const [rideType, setRideType] = useState<string>(ride.rideType);
  const [bikeId, setBikeId] = useState<string | ''>(ride.bikeId ?? '');
  const [notes, setNotes] = useState<string>(ride.notes ?? '');
  const [trailSystem, setTrailSystem] = useState<string>(ride.trailSystem ?? '');
  const [location, setLocation] = useState<string>(ride.location ?? '');

  const durationSeconds = useMemo(
    () => Math.max(0, Math.floor((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60)),
    [hours, minutes]
  );

  const [mutate, { loading, error }] = useMutation(UPDATE_RIDE, {
    // EITHER: patch cache for RIDES lists…
    update(cache, { data }) {
      const updated = data?.updateRide;
      if (!updated) return;
      // write the updated entity, then merge into list
      cache.updateQuery<{ rides: Ride[] }>({ query: RIDES }, (prev) =>
        prev ? { rides: prev.rides.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev
      );
    },
    // …or just refetch:
    // refetchQueries: [{ query: RIDES }],
    onCompleted: () => onClose(),
  });

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const iso = fromLocalInputValue(startLocal);

    await mutate({
      variables: {
        id: ride.id,
        input: {
          startTime: iso,
          durationSeconds,
          distanceMiles: Number(distanceMiles),
          elevationGainFeet: Number(elevationGainFeet),
          averageHr: averageHr === '' ? null : Math.floor(Number(averageHr)),
          rideType: rideType.trim(),
          bikeId: bikeId || null,
          notes: notes.trim() || null,
          trailSystem: trailSystem.trim() || null,
          location: location.trim() || null,
        },
      },
    }).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <form onSubmit={onSave} className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-4 grid gap-3">
        <h3 className="text-lg font-semibold">Edit Ride</h3>

        <label className="grid gap-1">
          <span className="text-sm">Start (local)</span>
          <input type="datetime-local" value={startLocal} onChange={e => setStartLocal(e.target.value)}
                 className="border rounded px-2 py-1" required />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-sm">Hours</span>
            <input type="number" min={0} value={hours} onChange={e => setHours(Number(e.target.value))}
                   className="border rounded px-2 py-1" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm">Minutes</span>
            <input type="number" min={0} max={59} value={minutes} onChange={e => setMinutes(Number(e.target.value))}
                   className="border rounded px-2 py-1" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1">
            <span className="text-sm">Distance (miles)</span>
            <input type="number" min={0} step={0.1} value={distanceMiles}
                   onChange={e => setDistanceMiles(Number(e.target.value))}
                   className="border rounded px-2 py-1" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm">Elevation Gain (feet)</span>
            <input type="number" min={0} step={1} value={elevationGainFeet}
                   onChange={e => setElevationGainFeet(Number(e.target.value))}
                   className="border rounded px-2 py-1" />
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-sm">Average HR (optional)</span>
          <input type="number" min={0} max={250} step={1} value={averageHr}
                 onChange={e => setAverageHr(e.target.value === '' ? '' : Number(e.target.value))}
                 className="border rounded px-2 py-1" />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Ride Type</span>
          <input type="text" value={rideType} onChange={e => setRideType(e.target.value)}
                 className="border rounded px-2 py-1" maxLength={32} />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Bike (optional)</span>
          <input type="text" value={bikeId} onChange={e => setBikeId(e.target.value)}
                 className="border rounded px-2 py-1" placeholder="Bike id (or leave blank)" />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Trail system (optional)</span>
          <input type="text" value={trailSystem} onChange={e => setTrailSystem(e.target.value)}
                 className="border rounded px-2 py-1" maxLength={120} />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Location (optional)</span>
          <input type="text" value={location} onChange={e => setLocation(e.target.value)}
                 className="border rounded px-2 py-1" maxLength={120} />
        </label>

        <label className="grid gap-1">
          <span className="text-sm">Notes (optional)</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    className="border rounded px-2 py-1" rows={3} maxLength={2000} />
        </label>

        {error && <div className="text-sm text-red-600">{error.message}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="border rounded px-3 py-2">
            Cancel
          </button>
          <button type="submit" className="border rounded px-3 py-2" disabled={loading}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
