// src/components/AddRideForm.tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { ADD_RIDE } from "../graphql/addRide";
import { BIKES } from "../graphql/bikes";
import { RIDE_TYPES } from "../graphql/rideTypes";

type Bike = { id: string; name: string };

const FALLBACK_RIDE_TYPES = [
  "TRAIL",
  "ENDURO",
  "COMMUTE",
  "ROAD",
  "GRAVEL",
  "TRAINER",
] as const;
const MAX_NOTES_LEN = 2000;

export default function AddRideForm({ onAdded }: { onAdded?: () => void }) {
  // --- queries must be INSIDE the component
  const { data: bikesData, loading: bikesLoading } = useQuery<{
    bikes: Bike[];
  }>(BIKES);
  const { data: rtData } = useQuery<{ rideTypes: string[] }>(RIDE_TYPES);
  const rideTypes: string[] = rtData?.rideTypes ?? [...FALLBACK_RIDE_TYPES];
  const bikes = bikesData?.bikes ?? [];

  // Start time (local)
  const [startLocal, setStartLocal] = useState<string>(() =>
    new Date().toISOString().slice(0, 16)
  );
  // Duration inputs
  const [hours, setHours] = useState<number>(1);
  const [minutes, setMinutes] = useState<number>(0);
  // Distance / Elevation (miles/feet)
  const [distanceMiles, setDistanceMiles] = useState<number>(10);
  const [elevationGainFeet, setElevationGainFeet] = useState<number>(500);
  // HR (optional)
  const [averageHr, setAverageHr] = useState<number | "">("");
  // Ride type & bike
  const [rideType, setRideType] = useState<string>(rideTypes[0] ?? "TRAIL");
  const [bikeId, setBikeId] = useState<string | "">("");
  // Notes
  const [notes, setNotes] = useState<string>("");
  const [trailSystem, setTrailSystem] = useState<string>("");
  const [location, setLocation] = useState<string>("");

  // Derived seconds
  const durationSeconds = useMemo(
    () =>
      Math.max(
        0,
        Math.floor((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60)
      ),
    [hours, minutes]
  );

  // Mutation
  const [addRide, { loading: saving, error: saveError }] = useMutation(
    ADD_RIDE,
    {
      onCompleted: () => onAdded?.(),
    }
  );

  // Validation
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(
    () => setFormError(null),
    [
      startLocal,
      hours,
      minutes,
      distanceMiles,
      elevationGainFeet,
      averageHr,
      rideType,
      bikeId,
      notes,
    ]
  );

  function validate(): string | null {
    if (!startLocal) return "Start time is required.";
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
      return "Duration must be greater than 0.";
    if (!Number.isFinite(distanceMiles) || distanceMiles < 0)
      return "Distance (miles) must be ≥ 0.";
    if (!Number.isFinite(elevationGainFeet) || elevationGainFeet < 0)
      return "Elevation gain (feet) must be ≥ 0.";
    if (
      averageHr !== "" &&
      (!Number.isFinite(Number(averageHr)) ||
        Number(averageHr) < 0 ||
        Number(averageHr) > 250)
    )
      return "Average HR should be between 0 and 250.";
    if (!rideType) return "Ride type is required.";
    if (notes.length > MAX_NOTES_LEN)
      return `Notes must be ≤ ${MAX_NOTES_LEN} characters.`;
    if (bikeId && !bikes.some((b) => b.id === bikeId))
      return "Selected bike is not valid.";
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
          averageHr: averageHr === "" ? null : Math.floor(Number(averageHr)),
          rideType,
          bikeId: bikeId || null,
          notes: notes.trim() || null,
          trailSystem: trailSystem.trim() || null,
          location: location.trim() || null,
        },
      },
      refetchQueries: ["Rides"],
    }).catch(() => {});
  }

  function resetForm() {
    setStartLocal(new Date().toISOString().slice(0, 16));
    setHours(1);
    setMinutes(0);
    setDistanceMiles(10);
    setElevationGainFeet(500);
    setAverageHr("");
    setRideType(rideTypes[0] ?? "TRAIL");
    setBikeId("");
    setNotes("");
    setFormError(null);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 p-4 border rounded-xl">
      {/* Start */}
      <label className="grid gap-1">
        <span className="text-sm">Start (local)</span>
        <input
          type="datetime-local"
          value={startLocal}
          onChange={(e) => setStartLocal(e.target.value)}
          className="border rounded px-2 py-1"
          required
        />
      </label>

      {/* Duration */}
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-sm">Hours</span>
          <input
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm">Minutes</span>
          <input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="border rounded px-2 py-1"
          />
        </label>
      </div>
      <div className="text-xs opacity-75">
        Total duration: {Math.floor(durationSeconds / 60)} min
      </div>

      {/* Distance & Elevation */}
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-sm">Distance (miles)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={distanceMiles}
            onChange={(e) => setDistanceMiles(Number(e.target.value))}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm">Elevation Gain (feet)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={elevationGainFeet}
            onChange={(e) => setElevationGainFeet(Number(e.target.value))}
            className="border rounded px-2 py-1"
          />
        </label>
      </div>

      {/* Avg HR */}
      <label className="grid gap-1">
        <span className="text-sm">Average HR (optional)</span>
        <input
          type="number"
          min={0}
          max={250}
          step={1}
          value={averageHr}
          onChange={(e) =>
            setAverageHr(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="border rounded px-2 py-1"
          placeholder="e.g., 145"
        />
      </label>

      {/* Ride Type */}
      <label className="grid gap-1">
        <span className="text-sm">Ride Type</span>
        <select
          value={rideType}
          onChange={(e) => setRideType(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {rideTypes.map((rt) => (
            <option key={rt} value={rt}>
              {rt}
            </option>
          ))}
        </select>
      </label>

      {/* Bike */}
      <label className="grid gap-1">
        <span className="text-sm">Bike (optional)</span>
        <select
          value={bikeId}
          onChange={(e) => setBikeId(e.target.value)}
          className="border rounded px-2 py-1"
          disabled={bikesLoading}
        >
          <option value="">No bike</option>
          {bikes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {bikesLoading && (
          <span className="text-xs opacity-60">Loading bikes…</span>
        )}
      </label>

      {/* Notes */}
      <label className="grid gap-1">
        <span className="text-sm">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={MAX_NOTES_LEN}
          rows={3}
          className="border rounded px-2 py-1"
          placeholder="Conditions, trails, workout details…"
        />
        <span className="text-xs opacity-60">
          {notes.length}/{MAX_NOTES_LEN}
        </span>
      </label>

      <label className="grid gap-1">
        <span className="text-sm">Trail system (optional)</span>
        <input
          type="text"
          value={trailSystem}
          onChange={(e) => setTrailSystem(e.target.value)}
          maxLength={120}
          className="border rounded px-2 py-1"
          placeholder="e.g., Fruita 18 Road"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-sm">Location (optional)</span>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={120}
          className="border rounded px-2 py-1"
          placeholder="e.g., Fruita, CO"
        />
      </label>

      {(formError || saveError) && (
        <div className="text-sm text-red-600">
          {formError || saveError?.message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="border rounded px-3 py-2"
          disabled={saving}
        >
          {saving ? "Saving…" : "Add Ride"}
        </button>
        <button
          type="button"
          className="border rounded px-3 py-2"
          onClick={resetForm}
          disabled={saving}
        >
          Reset
        </button>
        <button
          type="button"
          className="border rounded px-3 py-2"
          onClick={() => setStartLocal(new Date().toISOString().slice(0, 16))}
          disabled={saving}
          title="Set start time to now"
        >
          Now
        </button>
      </div>
    </form>
  );
}
