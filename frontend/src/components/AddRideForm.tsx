// src/components/AddRideForm.tsx
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@apollo/client';
import { ADD_RIDE } from '../graphql/addRide';

const SUGGESTED_TYPES = ['trail', 'enduro', 'commute', 'road', 'gravel', 'trainer'];

export default function AddRideForm({ onAdded }: { onAdded?: () => void }) {
  // --- existing state (same as your working form) ---
  const [startLocal, setStartLocal] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [hours, setHours] = useState<number>(1);
  const [minutes, setMinutes] = useState<number>(0);
  const [distanceMiles, setDistanceMiles] = useState<number>(10);
  const [elevationGainFeet, setElevationGainFeet] = useState<number>(500);
  const [averageHr, setAverageHr] = useState<number | ''>('');
  const [rideType, setRideType] = useState<string>('trail'); // free text since backend stores string
  const [bikeId, setBikeId] = useState<string | ''>('');     // keep if you’re using bikes
  const [notes, setNotes] = useState<string>('');
  const [trailSystem, setTrailSystem] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const MAX_NOTES_LEN = 2000;

  const durationSeconds = useMemo(
    () => Math.max(0, Math.floor((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60)),
    [hours, minutes]
  );

  const [addRide, { loading, error }] = useMutation(ADD_RIDE, {
    onCompleted: () => onAdded?.(),
  });

  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => setFormError(null), [
    startLocal, hours, minutes, distanceMiles, elevationGainFeet, averageHr, rideType, bikeId, notes, trailSystem, location,
  ]);

  function validate(): string | null {
    if (!startLocal) return 'Start time is required.';
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'Duration must be greater than 0.';
    if (!Number.isFinite(distanceMiles) || distanceMiles < 0) return 'Distance must be ≥ 0.';
    if (!Number.isFinite(elevationGainFeet) || elevationGainFeet < 0) return 'Elevation gain must be ≥ 0.';
    if (averageHr !== '' && (!Number.isFinite(Number(averageHr)) || Number(averageHr) < 0 || Number(averageHr) > 250)) {
      return 'Average HR should be between 0 and 250.';
    }
    if (!rideType.trim()) return 'Ride type is required.';
    if (notes.length > MAX_NOTES_LEN) return `Notes must be ≤ ${MAX_NOTES_LEN} characters.`;
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) return setFormError(err);

    const isoStart = new Date(startLocal).toISOString();
    await addRide({
      variables: {
        input: {
          startTime: isoStart,
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
      refetchQueries: ['Rides'],
    }).catch(() => {});
  }

  function resetForm() {
    setStartLocal(new Date().toISOString().slice(0, 16));
    setHours(1); setMinutes(0);
    setDistanceMiles(10); setElevationGainFeet(500);
    setAverageHr('');
    setRideType('trail');
    setBikeId('');
    setNotes('');
    setTrailSystem('');
    setLocation('');
    setFormError(null);
  }

  // Common input class (uses your theme tokens + Tailwind utilities)
  const inputCls =
    'w-full bg-app border border-app rounded-lg px-3 py-2 text-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]';

  const labelCls = 'block text-sm text-muted';

  return (
    <form
      onSubmit={onSubmit}
      className="bg-surface border border-app rounded-xl shadow p-6 space-y-4"
    >
      <h2 className="text-heading text-xl">Log a New Ride</h2>

      {/* Start time */}
      <div className="space-y-1">
        <label className={labelCls}>Start (local)</label>
        <input
          type="datetime-local"
          value={startLocal}
          onChange={e => setStartLocal(e.target.value)}
          className={inputCls}
          required
        />
      </div>

      {/* Duration */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelCls}>Hours</label>
          <input
            type="number"
            min={0}
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Minutes</label>
          <input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
            className={inputCls}
          />
        </div>
      </div>
      <div className="text-xs text-muted">Total duration: {Math.floor(durationSeconds / 60)} min</div>

      {/* Distance / Elevation */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelCls}>Distance (miles)</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={distanceMiles}
            onChange={e => setDistanceMiles(Number(e.target.value))}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Elevation Gain (feet)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={elevationGainFeet}
            onChange={e => setElevationGainFeet(Number(e.target.value))}
            className={inputCls}
          />
        </div>
      </div>

      {/* Avg HR */}
      <div className="space-y-1">
        <label className={labelCls}>Average HR (optional)</label>
        <input
          type="number"
          min={0}
          max={250}
          step={1}
          value={averageHr}
          onChange={e => setAverageHr(e.target.value === '' ? '' : Number(e.target.value))}
          className={inputCls}
          placeholder="e.g., 145"
        />
      </div>

      {/* Ride type + Bike (optional id) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelCls}>Ride Type</label>
          <input
            type="text"
            list="ride-type-suggest"
            value={rideType}
            onChange={e => setRideType(e.target.value)}
            className={inputCls}
            maxLength={32}
            placeholder="trail / road / …"
          />
          <datalist id="ride-type-suggest">
            {SUGGESTED_TYPES.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Bike (optional id)</label>
          <input
            type="text"
            value={bikeId}
            onChange={e => setBikeId(e.target.value)}
            className={inputCls}
            placeholder="Leave blank if none"
          />
        </div>
      </div>

      {/* Trail system / Location */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelCls}>Trail system (optional)</label>
          <input
            type="text"
            value={trailSystem}
            onChange={e => setTrailSystem(e.target.value)}
            className={inputCls}
            maxLength={120}
            placeholder="e.g., Copper Harbor"
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Location (optional)</label>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            className={inputCls}
            maxLength={120}
            placeholder="e.g., MI, USA"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className={labelCls}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          maxLength={MAX_NOTES_LEN}
          className={inputCls + ' resize-y'}
          placeholder="Conditions, trails, workout details…"
        />
        <div className="text-xs text-muted">{notes.length}/{MAX_NOTES_LEN}</div>
      </div>

      {(formError || error) && (
        <div className="text-sm" style={{ color: 'rgb(var(--danger))' }}>
          {formError || error?.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={resetForm}
          className="btn-secondary"
          title="Reset form"
        >
          Reset
        </button>
        <button
          type="submit"
          className="btn-accent"
          disabled={loading}
        >
          {loading ? 'Saving…' : 'Save Ride'}
        </button>
      </div>
    </form>
  );
}
