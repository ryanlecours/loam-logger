// src/components/AddRideForm.tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client';
import { ADD_RIDE } from '../graphql/addRide';
import { BIKES } from '../graphql/bikes';
import { Select, Textarea, Button } from './ui';

const SUGGESTED_TYPES = ['trail', 'enduro', 'commute', 'road', 'gravel', 'trainer'];

type BikeSummary = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

const formatBikeName = (bike: BikeSummary) =>
  (bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim() || 'Bike').trim();

export default function AddRideForm({ onAdded }: { onAdded?: () => void }) {
  // Core required fields
  const [startLocal, setStartLocal] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [hours, setHours] = useState<number>(1);
  const [minutes, setMinutes] = useState<number>(0);
  const [distanceMiles, setDistanceMiles] = useState<number>(10);
  const [elevationGainFeet, setElevationGainFeet] = useState<number>(500);
  const [rideType, setRideType] = useState<string>('trail');
  const [bikeId, setBikeId] = useState<string | ''>('');

  // Optional fields
  const [averageHr, setAverageHr] = useState<number | ''>('');
  const [notes, setNotes] = useState<string>('');
  const [trailSystem, setTrailSystem] = useState<string>('');
  const [location, setLocation] = useState<string>('');

  // UI state
  const [showDetails, setShowDetails] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const MAX_NOTES_LEN = 2000;

  const {
    data: bikesData,
    loading: bikesLoading,
    error: bikesError,
  } = useQuery<{ bikes: BikeSummary[] }>(BIKES, { fetchPolicy: 'cache-and-network' });
  const userBikes = useMemo(() => bikesData?.bikes ?? [], [bikesData]);

  const durationSeconds = useMemo(
    () => Math.max(0, Math.floor((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60)),
    [hours, minutes]
  );

  const [addRide, { loading, error }] = useMutation(ADD_RIDE, {
    onCompleted: () => {
      onAdded?.();
      resetForm();
      setIsExpanded(false);
    },
  });

  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (userBikes.length === 1) {
      setBikeId((current) => current || userBikes[0].id);
    } else if (userBikes.length === 0) {
      setBikeId('');
    } else {
      setBikeId((current) => (userBikes.some((bike) => bike.id === current) ? current : ''));
    }
  }, [userBikes]);

  useEffect(() => setFormError(null), [
    startLocal, hours, minutes, distanceMiles, elevationGainFeet, averageHr, rideType, bikeId, notes, trailSystem, location,
  ]);

  function validate(): string | null {
    if (!startLocal) return 'Start time is required.';
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'Duration must be greater than 0.';
    if (!Number.isFinite(distanceMiles) || distanceMiles < 0) return 'Distance must be >= 0.';
    if (!Number.isFinite(elevationGainFeet) || elevationGainFeet < 0) return 'Elevation gain must be >= 0.';
    if (averageHr !== '' && (!Number.isFinite(Number(averageHr)) || Number(averageHr) < 0 || Number(averageHr) > 250)) {
      return 'Average HR should be between 0 and 250.';
    }
    if (!rideType.trim()) return 'Ride type is required.';
    if (userBikes.length === 0) return 'Add a bike in Gear before logging a ride.';
    if (userBikes.length > 0 && !bikeId) return 'Please select which bike you rode.';
    if (notes.length > MAX_NOTES_LEN) return `Notes must be <= ${MAX_NOTES_LEN} characters.`;
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
    setBikeId(userBikes.length === 1 ? userBikes[0].id : '');
    setNotes('');
    setTrailSystem('');
    setLocation('');
    setFormError(null);
    setShowDetails(false);
  }

  const submitDisabled = loading || bikesLoading || userBikes.length === 0 || !bikeId;
  const submitLabel = userBikes.length === 0 ? 'Add a bike to log rides' : loading ? 'Saving...' : 'Save Ride';

  // Collapsed quick-add view
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full bg-surface-2/30 hover:bg-surface-2/50 border border-app/50 hover:border-primary/30 rounded-2xl p-6 text-left transition-all duration-200 group"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white group-hover:text-primary transition-colors">
              Log a New Ride
            </h3>
            <p className="text-sm text-muted mt-1">
              Quick entry or detailed logging
            </p>
          </div>
          <div className="bg-surface-2/50 group-hover:bg-primary/10 border border-app group-hover:border-primary/30 rounded-xl p-3 transition-all">
            <svg className="w-5 h-5 text-muted group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
        </div>
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="panel-soft shadow-soft border border-app rounded-2xl p-6 space-y-5"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-white">Log a New Ride</h3>
        <button
          type="button"
          onClick={() => {
            setIsExpanded(false);
            resetForm();
          }}
          className="text-muted hover:text-white transition-colors p-1"
          title="Collapse"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Essential Info - Always visible */}
      <div className="space-y-4">
        {/* Quick Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted mb-1.5">Duration</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min={0}
                  value={hours}
                  onChange={e => setHours(Number(e.target.value))}
                  className="input-soft pr-8 text-center"
                  placeholder="1"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/60 pointer-events-none">h</span>
              </div>
              <div className="relative flex-1">
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={e => setMinutes(Number(e.target.value))}
                  className="input-soft pr-8 text-center"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/60 pointer-events-none">m</span>
              </div>
            </div>
            <p className="text-xs text-muted/80">{Math.floor(durationSeconds / 60)} total min</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted mb-1.5">Distance</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={0.1}
                value={distanceMiles}
                onChange={e => setDistanceMiles(Number(e.target.value))}
                className="input-soft pr-12 text-center"
                placeholder="10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/60 pointer-events-none">mi</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted mb-1.5">Elevation</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={1}
                value={elevationGainFeet}
                onChange={e => setElevationGainFeet(Number(e.target.value))}
                className="input-soft pr-12 text-center"
                placeholder="500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/60 pointer-events-none">ft</span>
            </div>
          </div>
        </div>

        {/* Type and Bike Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted mb-1.5">Ride Type</label>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setRideType(type)}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${rideType === type
                      ? 'bg-primary/20 text-primary border-primary/30'
                      : 'bg-surface-2/30 text-muted border-app/50 hover:border-primary/20 hover:text-white'
                    }
                  `}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted mb-1.5">Bike</label>
            {bikesLoading ? (
              <div className="text-sm text-muted">Loading bikes...</div>
            ) : userBikes.length > 0 ? (
              <Select
                value={bikeId}
                onChange={(e) => setBikeId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a bike
                </option>
                {userBikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {formatBikeName(bike)}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="text-sm text-muted bg-surface-2/20 border border-app/50 rounded-lg p-2.5">
                No bikes yet.{' '}
                <Link to="/gear" className="underline text-accent hover:text-accent/80">
                  Add a bike
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Optional Details - Collapsible */}
      <div className="border-t border-app/30 pt-4">
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors mb-4"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>{showDetails ? 'Hide' : 'Show'} optional details</span>
          <span className="text-xs text-muted/60">(time, HR, location, notes)</span>
        </button>

        {showDetails && (
          <div className="space-y-4">
            {/* Start Time */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-muted mb-1.5">Start Time</label>
              <input
                type="datetime-local"
                value={startLocal}
                onChange={e => setStartLocal(e.target.value)}
                className="input-soft"
                required
              />
            </div>

            {/* HR */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-muted mb-1.5">Average Heart Rate</label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={250}
                  step={1}
                  value={averageHr}
                  onChange={e => setAverageHr(e.target.value === '' ? '' : Number(e.target.value))}
                  className="input-soft pr-16"
                  placeholder="145"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/60 pointer-events-none">bpm</span>
              </div>
            </div>

            {/* Location fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-muted mb-1.5">Trail System</label>
                <input
                  type="text"
                  value={trailSystem}
                  onChange={e => setTrailSystem(e.target.value)}
                  className="input-soft"
                  maxLength={120}
                  placeholder="Copper Harbor"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-muted mb-1.5">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="input-soft"
                  maxLength={120}
                  placeholder="MI, USA"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Textarea
                label="Notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                maxLength={MAX_NOTES_LEN}
                placeholder="Conditions, trails, workout details..."
                hint={`${notes.length}/${MAX_NOTES_LEN}`}
              />
            </div>
          </div>
        )}
      </div>

      {/* Error Display */}
      {(formError || error || bikesError) && (
        <div className="alert alert-danger">
          {formError || error?.message || bikesError?.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between items-center gap-3 pt-2">
        <button
          type="button"
          onClick={resetForm}
          className="text-sm text-muted hover:text-white transition-colors"
        >
          Reset
        </button>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsExpanded(false);
              resetForm();
            }}
            className="px-6 py-2.5"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="px-6 py-2.5"
            disabled={submitDisabled}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
