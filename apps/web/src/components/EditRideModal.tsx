import { useState, useMemo } from 'react';
import { useMutation } from '@apollo/client';
import { UPDATE_RIDE } from '../graphql/updateRide';
import { RIDES } from '../graphql/rides';
import { toLocalInputValue, fromLocalInputValue } from '../lib/format';
import { Modal, Input, Textarea, Button } from './ui';

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
    update(cache, { data }) {
      const updated = data?.updateRide;
      if (!updated) return;
      cache.updateQuery<{ rides: Ride[] }>({ query: RIDES }, (prev) =>
        prev ? { rides: prev.rides.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev
      );
    },
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
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Edit Ride"
      size="lg"
      preventClose={loading}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading} onClick={onSave}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSave} className="space-y-4">
        <Input
          label="Start (local)"
          type="datetime-local"
          value={startLocal}
          onChange={e => setStartLocal(e.target.value)}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Hours"
            type="number"
            min={0}
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
          />
          <Input
            label="Minutes"
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Distance (miles)"
            type="number"
            min={0}
            step={0.1}
            value={distanceMiles}
            onChange={e => setDistanceMiles(Number(e.target.value))}
          />
          <Input
            label="Elevation Gain (feet)"
            type="number"
            min={0}
            step={1}
            value={elevationGainFeet}
            onChange={e => setElevationGainFeet(Number(e.target.value))}
          />
        </div>

        <Input
          label="Average HR (optional)"
          type="number"
          min={0}
          max={250}
          step={1}
          value={averageHr}
          onChange={e => setAverageHr(e.target.value === '' ? '' : Number(e.target.value))}
        />

        <Input
          label="Ride Type"
          type="text"
          value={rideType}
          onChange={e => setRideType(e.target.value)}
          maxLength={32}
        />

        <Input
          label="Bike (optional)"
          type="text"
          value={bikeId}
          onChange={e => setBikeId(e.target.value)}
          placeholder="Bike id (or leave blank)"
        />

        <Input
          label="Trail system (optional)"
          type="text"
          value={trailSystem}
          onChange={e => setTrailSystem(e.target.value)}
          maxLength={120}
        />

        <Input
          label="Location (optional)"
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          maxLength={120}
        />

        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
        />

        {error && <div className="text-sm text-danger">{error.message}</div>}
      </form>
    </Modal>
  );
}
