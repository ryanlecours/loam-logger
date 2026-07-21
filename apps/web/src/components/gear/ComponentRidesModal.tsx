import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { CircleMinus, CirclePlus, History, RotateCcw, TriangleAlert } from 'lucide-react';

import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  COMPONENT_RIDES,
  SET_COMPONENT_RIDE_ADJUSTMENT,
  CLEAR_COMPONENT_RIDE_ADJUSTMENT,
} from '../../graphql/componentRides';
import { RIDES } from '../../graphql/rides';
import { BIKES } from '../../graphql/bikes';
import { formatDurationCompact } from '../../utils/formatters';

const PAGE_SIZE = 50;
// Bounded pull for the Add-rides tab; plenty for manual swap corrections.
const ADD_RIDES_TAKE = 300;

type RideDto = {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters?: number | null;
  location?: string | null;
  trailSystem?: string | null;
  rideType?: string | null;
  bikeId?: string | null;
};

type ComponentRideEntry = {
  counted: boolean;
  adjustment: 'EXCLUDE' | 'INCLUDE' | null;
  beforeAnchor: boolean;
  ride: RideDto;
};

type ComponentRidesPayload = {
  componentRides: {
    componentId: string;
    anchor: string | null;
    countedHours: number;
    hoursUsed: number;
    countedRideCount: number;
    hasMore: boolean;
    entries: ComponentRideEntry[];
  };
};

interface ComponentRidesModalProps {
  componentId: string;
  componentLabel: string;
  /** The component's bike — used to filter the Add-rides tab to other bikes. */
  bikeId?: string | null;
  onClose: () => void;
}

function formatRideDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function rideTitle(ride: RideDto): string {
  return ride.trailSystem || ride.location || ride.rideType || 'Ride';
}

/**
 * "View rides" modal for one component: lists the rides that sum to its
 * current hours (canonical attribution), lets the rider Remove/Restore an
 * on-bike ride's hours, and Apply rides from other bikes (swap correction).
 * Totals come from the server's canonical recompute — no optimistic math.
 */
export function ComponentRidesModal({
  componentId,
  componentLabel,
  bikeId,
  onClose,
}: ComponentRidesModalProps) {
  const [tab, setTab] = useState<'counted' | 'add'>('counted');
  const [pendingRideId, setPendingRideId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, fetchMore, refetch } = useQuery<ComponentRidesPayload>(COMPONENT_RIDES, {
    variables: { componentId, take: PAGE_SIZE },
    fetchPolicy: 'cache-and-network',
  });

  // Rides from other bikes / unassigned, for the Apply tab. Only fetched
  // once the rider opens that tab.
  const { data: ridesData, loading: ridesLoading } = useQuery<{ rides: RideDto[] }>(RIDES, {
    variables: { take: ADD_RIDES_TAKE },
    skip: tab !== 'add',
    fetchPolicy: 'cache-first',
  });

  const payload = data?.componentRides;
  const entries = useMemo(() => payload?.entries ?? [], [payload]);

  // Refetch the modal's own list + the bike predictions after any change.
  const refetchAfterMutation = {
    refetchQueries: [{ query: BIKES }],
    onCompleted: () => {
      refetch();
      setPendingRideId(null);
    },
    onError: (err: Error) => {
      setError(err.message || 'Something went wrong.');
      setPendingRideId(null);
    },
  };
  const [setAdjustment] = useMutation(SET_COMPONENT_RIDE_ADJUSTMENT, refetchAfterMutation);
  const [clearAdjustment] = useMutation(CLEAR_COMPONENT_RIDE_ADJUSTMENT, refetchAfterMutation);

  const runForRide = (rideId: string, run: () => Promise<unknown>) => {
    setError(null);
    setPendingRideId(rideId);
    run().catch(() => {
      /* handled in onError */
    });
  };

  // Candidate rides for Apply: not on this component's bike, not already
  // adjusted (the entries list carries every INCLUDE row, incl. dormant).
  const adjustedRideIds = useMemo(
    () => new Set(entries.filter((e) => e.adjustment != null).map((e) => e.ride.id)),
    [entries]
  );
  const addCandidates = useMemo(
    () =>
      (ridesData?.rides ?? []).filter(
        (ride) => (ride.bikeId ?? null) !== (bikeId ?? null) && !adjustedRideIds.has(ride.id)
      ),
    [ridesData, bikeId, adjustedRideIds]
  );

  const totalsDiffer =
    payload != null && Math.abs(payload.countedHours - payload.hoursUsed) >= 0.05;

  return (
    <Modal isOpen onClose={onClose} title={`Rides · ${componentLabel}`} size="lg">
      <div className="space-y-3">
        {/* Totals header */}
        <div className="flex items-center gap-2 text-sm">
          <History size={14} className="icon-sage" />
          <span className="font-medium">
            {payload ? `${payload.countedHours.toFixed(1)}h` : '—'}
          </span>
          <span className="text-muted">
            from {payload?.countedRideCount ?? '—'} rides
            {payload?.anchor
              ? ` since service on ${formatRideDate(payload.anchor)}`
              : ' (all time)'}
          </span>
        </div>
        {totalsDiffer && (
          <p className="text-xs text-muted">
            Stored hours ({payload!.hoursUsed.toFixed(1)}h) will be recalculated from ride
            history on your first change.
          </p>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-2">
          <Button
            variant={tab === 'counted' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setTab('counted')}
          >
            Counted rides
          </Button>
          <Button
            variant={tab === 'add' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setTab('add')}
          >
            Add rides
          </Button>
        </div>

        {error && (
          <div className="alert-inline alert-inline-error">
            <TriangleAlert size={14} />
            {error}
          </div>
        )}

        {tab === 'counted' ? (
          <div className="space-y-1">
            {loading && entries.length === 0 && (
              <p className="text-sm text-muted">Loading rides…</p>
            )}
            {!loading && entries.length === 0 && (
              <p className="text-sm text-muted">
                No rides are counted toward this component yet.
              </p>
            )}
            {entries.map((entry) => {
              const { ride } = entry;
              const busy = pendingRideId === ride.id;
              return (
                <div
                  key={ride.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-app px-3 py-2"
                  data-testid={`component-ride-${ride.id}`}
                >
                  <div className="min-w-0">
                    <div className={`text-sm truncate ${entry.counted ? '' : 'text-muted line-through'}`}>
                      {rideTitle(ride)}
                    </div>
                    <div className="text-xs text-muted">
                      {formatRideDate(ride.startTime)} · {formatDurationCompact(ride.durationSeconds)}
                      {entry.adjustment === 'INCLUDE' && ' · applied from another bike'}
                      {entry.beforeAnchor && (
                        <span className="text-warning"> · predates last service</span>
                      )}
                    </div>
                  </div>
                  {entry.adjustment === 'EXCLUDE' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        runForRide(ride.id, () =>
                          clearAdjustment({ variables: { componentId, rideId: ride.id } })
                        )
                      }
                    >
                      <RotateCcw size={12} className="icon-left" />
                      {busy ? 'Restoring…' : 'Restore'}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        runForRide(ride.id, () =>
                          entry.adjustment === 'INCLUDE'
                            ? clearAdjustment({ variables: { componentId, rideId: ride.id } })
                            : setAdjustment({
                                variables: { componentId, rideId: ride.id, kind: 'EXCLUDE' },
                              })
                        )
                      }
                    >
                      <CircleMinus size={12} className="icon-left" />
                      {busy ? 'Removing…' : 'Remove'}
                    </Button>
                  )}
                </div>
              );
            })}
            {payload?.hasMore && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  fetchMore({
                    variables: { after: entries[entries.length - 1]?.ride.id },
                    updateQuery: (prev: ComponentRidesPayload, { fetchMoreResult }) => {
                      if (!fetchMoreResult) return prev;
                      return {
                        componentRides: {
                          ...fetchMoreResult.componentRides,
                          entries: [
                            ...prev.componentRides.entries,
                            ...fetchMoreResult.componentRides.entries,
                          ],
                        },
                      };
                    },
                  })
                }
              >
                Load more
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted">
              Apply a ride from another bike (or an unassigned ride) to this component —
              e.g. when this part was temporarily mounted elsewhere.
            </p>
            {ridesLoading && <p className="text-sm text-muted">Loading rides…</p>}
            {!ridesLoading && addCandidates.length === 0 && (
              <p className="text-sm text-muted">No rides from other bikes to apply.</p>
            )}
            {addCandidates.map((ride) => {
              const busy = pendingRideId === ride.id;
              return (
                <div
                  key={ride.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-app px-3 py-2"
                  data-testid={`component-ride-add-${ride.id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm truncate">{rideTitle(ride)}</div>
                    <div className="text-xs text-muted">
                      {formatRideDate(ride.startTime)} · {formatDurationCompact(ride.durationSeconds)}
                      {ride.bikeId == null && ' · unassigned'}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      runForRide(ride.id, () =>
                        setAdjustment({
                          variables: { componentId, rideId: ride.id, kind: 'INCLUDE' },
                        })
                      )
                    }
                  >
                    <CirclePlus size={12} className="icon-left" />
                    {busy ? 'Applying…' : 'Apply'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
