import { useMutation, useQuery } from '@apollo/client';
import { CableCar } from 'lucide-react';
import { RIDE_LIFT, SET_RIDE_LIFT_ELEVATION } from '../graphql/rideLift';
import { fmtElevation } from '../lib/format';
import { liftLapCount, liftNames, liftTagLabel, type RideLiftKind } from '../lib/rideLift';
import { usePreferences } from '../hooks/usePreferences';
import { Badge } from './ui';
import OsmCredit from './attribution/OsmCredit';

type RideLift = {
  elevationGainMeters: number;
  countElevation: boolean;
  countElevationChoice: boolean | null;
  segments: { startTime: string; liftName: string | null; kind: RideLiftKind | null }[];
};

type RideLiftData = {
  ride: {
    __typename?: 'Ride';
    id: string;
    elevationGainMeters: number;
    countedElevationGainMeters: number;
    lift: RideLift | null;
  } | null;
};

/**
 * "Chairlift detected" tag for one ride, with the rider's choice about the
 * lift's climb. Self-hides when no lift was detected. The choice saves on
 * change; the ride's counted climb (shown in the rides list and the stats)
 * follows through the normalized Ride in the cache.
 */
export default function RideLiftPanel({ rideId }: { rideId: string }) {
  const { distanceUnit } = usePreferences();
  const { data } = useQuery<RideLiftData>(RIDE_LIFT, {
    variables: { id: rideId },
    fetchPolicy: 'cache-and-network',
  });
  const [saveChoice, { loading: saving, error }] = useMutation(SET_RIDE_LIFT_ELEVATION);

  const ride = data?.ride;
  const lift = ride?.lift;
  if (!ride || !lift || lift.segments.length === 0) return null;

  const names = liftNames(lift.segments);
  const liftClimb = fmtElevation(lift.elevationGainMeters, distanceUnit);
  const recordedClimb = fmtElevation(ride.elevationGainMeters, distanceUnit);
  const countedClimb = fmtElevation(ride.countedElevationGainMeters, distanceUnit);

  const onToggle = (count: boolean) => {
    saveChoice({
      variables: { rideId, count },
      optimisticResponse: {
        setRideLiftElevation: {
          ...ride,
          __typename: 'Ride',
          countedElevationGainMeters: count
            ? ride.elevationGainMeters
            : Math.max(0, ride.elevationGainMeters - lift.elevationGainMeters),
          lift: { ...lift, countElevation: count, countElevationChoice: count },
        },
      },
    }).catch(() => {});
  };

  return (
    <section className="mt-4 rounded-lg border border-app/60 bg-surface-2 p-4" aria-label="Lift detection">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info" icon={<CableCar size={12} aria-hidden="true" />}>
          {liftTagLabel(lift.segments.map((s) => s.kind))}
        </Badge>
        <span className="text-sm text-muted">
          {liftLapCount(lift.segments.length)}
          {names.length > 0 && ` on ${names.join(', ')}`}
        </span>
      </div>

      <label className="mt-3 flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={lift.countElevation}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={saving}
          className="mt-1 w-5 h-5 rounded border-app bg-surface accent-accent flex-shrink-0 disabled:opacity-50"
        />
        <span className="text-sm text-primary">
          Count the lift climb in this ride
          <span className="block text-xs text-muted">
            {lift.countElevation
              ? `The lift climbed ${liftClimb} for you. This ride counts all ${recordedClimb} recorded.`
              : `The lift climbed ${liftClimb} for you, so this ride counts ${countedClimb} of the ${recordedClimb} recorded.`}
          </span>
        </span>
      </label>

      {error && <div className="mt-2 text-sm text-danger">Couldn't save your choice. {error.message}</div>}

      <OsmCredit className="mt-3" />
    </section>
  );
}
