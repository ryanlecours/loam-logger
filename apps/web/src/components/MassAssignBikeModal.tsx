import { useState, useMemo, useCallback, useEffect } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useAssignBikeToRides } from '../graphql/importSession';
import {
  PROVIDER_FROM_SOURCE,
  useUnassignedRideIds,
  useUnassignedRideSummary,
  type RideProvider,
} from '../graphql/unassignedRides';
import { SOURCE_LABELS, type RideSource } from '../utils/rideSource';
import { formatRideDate, getBikeName } from '../utils/formatters';
import { SECONDS_PER_HOUR } from '../constants/dashboard';

type Bike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

type ProviderFilter = 'all' | RideProvider;

interface MassAssignBikeModalProps {
  isOpen: boolean;
  onClose: () => void;
  bikes: Bike[];
  onSuccess?: () => void;
}

/**
 * Rides per mutation call. The server caps a single assignBikeToRides at 2000;
 * this stays well under it so a rider with a decade of Garmin history gets
 * steady progress and a bounded transaction per call rather than one enormous
 * write that either lands or doesn't.
 */
const ASSIGN_CHUNK_SIZE = 500;

/** Never ask the server for more ids than it will accept in a single pass. */
const MAX_RIDES_PER_PASS = 2000;

/** A YYYY-MM-DD input value as an ISO instant at the local start/end of day. */
function toIsoBound(date: string, edge: 'start' | 'end'): string {
  const time = edge === 'start' ? 'T00:00:00.000' : 'T23:59:59.999';
  return new Date(date + time).toISOString();
}

export function MassAssignBikeModal({
  isOpen,
  onClose,
  bikes,
  onSuccess,
}: MassAssignBikeModalProps) {
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [assignBikeToRides] = useAssignBikeToRides();
  const [fetchRideIds] = useUnassignedRideIds();

  // Validate date range (start should not be after end)
  const isInvalidDateRange = !!(startDate && endDate && new Date(startDate) > new Date(endDate));

  const filter = useMemo(
    () => ({
      startDate: startDate ? toIsoBound(startDate, 'start') : null,
      endDate: endDate ? toIsoBound(endDate, 'end') : null,
      provider: providerFilter === 'all' ? null : providerFilter,
    }),
    [startDate, endDate, providerFilter]
  );

  // The selection lives on the server, not in a list this modal happens to
  // hold. The previous version filtered the rides the page had already
  // loaded, so "assign every unassigned Garmin ride" silently meant "...of the
  // ones inside the page's current date filter", and it had no way to tell a
  // ride marked "not my bike" from one still awaiting an answer.
  const { data, loading: summaryLoading, refetch: refetchSummary } = useUnassignedRideSummary(
    filter,
    { skip: !isOpen || isInvalidDateRange }
  );
  const summary = data?.unassignedRideSummary;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedBikeId(bikes.length === 1 ? bikes[0].id : '');
      setStartDate('');
      setEndDate('');
      setProviderFilter('all');
      setError(null);
      setSuccessMessage(null);
      setProgress(null);
    }
  }, [isOpen, bikes]);

  const matchCount = summary?.totalCount ?? 0;
  // What a single pass actually covers. The button must not promise the whole
  // match when the cap means only part of it lands.
  const isCapped = matchCount > MAX_RIDES_PER_PASS;
  const passCount = Math.min(matchCount, MAX_RIDES_PER_PASS);
  const matchHours = Math.round((summary?.totalDurationSeconds ?? 0) / SECONDS_PER_HOUR);

  // byProvider always describes the date-scoped set regardless of which
  // provider is selected, so its sum is the "All providers" count and the
  // picker never strands the rider inside one bucket.
  const providerCounts = useMemo(() => summary?.byProvider ?? [], [summary?.byProvider]);
  const allProvidersCount = providerCounts.reduce((sum, entry) => sum + entry.count, 0);

  const providerOptions = useMemo(() => {
    const options: { value: ProviderFilter; label: string; count: number }[] = [
      { value: 'all', label: 'All providers', count: allProvidersCount },
    ];
    // Ordered by the labels map rather than the server's response so the row
    // does not reshuffle as counts change under the rider.
    for (const source of Object.keys(SOURCE_LABELS) as RideSource[]) {
      const provider = PROVIDER_FROM_SOURCE[source];
      const match = providerCounts.find((entry) => entry.provider === provider);
      // Keep the selected option visible even at zero, so the rider can see
      // why the preview says nothing matches instead of watching the radio
      // they just picked disappear.
      if (!match && providerFilter !== provider) continue;
      options.push({ value: provider, label: SOURCE_LABELS[source], count: match?.count ?? 0 });
    }
    return options;
  }, [providerCounts, allProvidersCount, providerFilter]);

  const handleAssign = useCallback(async () => {
    if (!selectedBikeId || matchCount === 0) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    setProgress(null);

    let assigned = 0;

    try {
      const { data: idData } = await fetchRideIds({
        variables: {
          filter: { ...filter, unassigned: true },
          take: MAX_RIDES_PER_PASS,
        },
      });
      const rideIds = (idData?.rides ?? []).map((ride) => ride.id);

      if (rideIds.length === 0) {
        // Deliberately does not name a cause. A ride leaves the unassigned set
        // by gaining a bike OR by being flagged "not my bike", and from here
        // the two are indistinguishable.
        setError('Those rides are no longer waiting on a bike. Nothing left to assign.');
        return;
      }

      setProgress({ done: 0, total: rideIds.length });

      for (let offset = 0; offset < rideIds.length; offset += ASSIGN_CHUNK_SIZE) {
        const chunk = rideIds.slice(offset, offset + ASSIGN_CHUNK_SIZE);
        const result = await assignBikeToRides({
          variables: { rideIds: chunk, bikeId: selectedBikeId },
        });
        assigned += result.data?.assignBikeToRides?.updatedCount ?? chunk.length;
        setProgress({ done: assigned, total: rideIds.length });
      }

      // Call onSuccess to trigger refetch in parent
      onSuccess?.();

      // What still matches now that the writes have landed, rather than the
      // count the preview was showing before them. Rides can leave the set
      // for reasons this pass had nothing to do with (assigned in another
      // tab, flagged "not my bike"), so subtracting from the previewed count
      // would quote a stale number back to the rider.
      let remaining: number;
      try {
        const refreshed = await refetchSummary();
        remaining = refreshed.data?.unassignedRideSummary?.totalCount ?? 0;
      } catch {
        // A failed refetch is a stale screen, not a failed assignment. Fall
        // back to the previewed count so the rider still gets a number.
        remaining = Math.max(0, matchCount - assigned);
      }

      setSuccessMessage(
        remaining > 0
          ? `Assigned ${assigned} rides. ${remaining} more match: assign again to continue.`
          : `Assigned ${assigned} ride${assigned !== 1 ? 's' : ''} to bike!`
      );
    } catch (err) {
      console.error('Failed to assign bikes:', err);
      // Each chunk is its own transaction, so a mid-run failure leaves real
      // work done. Saying "failed" flatly would send the rider back to assign
      // the same rides again.
      setError(
        assigned > 0
          ? `Assigned ${assigned} rides, then hit an error. The rest are unchanged: try again.`
          : 'Failed to assign rides. Please try again.'
      );
      if (assigned > 0) {
        onSuccess?.();
        await refetchSummary();
      }
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  }, [
    selectedBikeId,
    matchCount,
    filter,
    fetchRideIds,
    assignBikeToRides,
    onSuccess,
    refetchSummary,
  ]);

  const selectedBike = bikes.find((b) => b.id === selectedBikeId);

  const dateSpan =
    summary?.earliestStartTime && summary?.latestStartTime
      ? `${formatRideDate(summary.earliestStartTime)} to ${formatRideDate(summary.latestStartTime)}`
      : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mass Assign Bike"
      subtitle="Assign a bike to multiple unassigned rides at once"
      size="md"
    >
      <div className="space-y-5">
        {bikes.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-muted">You don't have any bikes yet.</p>
            <p className="text-sm text-muted mt-1">Add a bike from the Dashboard first.</p>
          </div>
        ) : (
          <>
            {/* Bike Selector */}
            <div>
              <label htmlFor="mass-assign-bike" className="block text-sm font-medium text-white mb-2">
                Select Bike
              </label>
              <select
                id="mass-assign-bike"
                value={selectedBikeId}
                onChange={(e) => {
                  setSelectedBikeId(e.target.value);
                  setSuccessMessage(null);
                }}
                className="w-full px-3 py-2 rounded-lg border border-app/50 bg-surface-2 text-white focus:ring-primary focus:border-primary"
              >
                <option value="">Choose a bike...</option>
                {bikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {getBikeName(bike)}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Date Range <span className="text-muted font-normal">(optional)</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  aria-label="Start date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setSuccessMessage(null);
                  }}
                  className="flex-1 px-3 py-2 rounded-lg border border-app/50 bg-surface-2 text-white focus:ring-primary focus:border-primary"
                />
                <span className="text-muted">to</span>
                <input
                  type="date"
                  aria-label="End date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setSuccessMessage(null);
                  }}
                  className="flex-1 px-3 py-2 rounded-lg border border-app/50 bg-surface-2 text-white focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            {/* Provider Filter */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Provider
              </label>
              <div className="flex flex-wrap gap-3">
                {providerOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 cursor-pointer text-sm text-white hover:text-primary transition-colors"
                  >
                    <input
                      type="radio"
                      name="providerFilter"
                      checked={providerFilter === option.value}
                      onChange={() => {
                        setProviderFilter(option.value);
                        setSuccessMessage(null);
                      }}
                      className="w-4 h-4 border-app/50 bg-surface-2 text-primary focus:ring-primary focus:ring-offset-0"
                    />
                    <span>{option.label}</span>
                    <span className="text-muted">{option.count}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="pt-3 border-t border-app/30">
              {isInvalidDateRange ? (
                <p className="text-sm text-warning">
                  Start date must be before end date.
                </p>
              ) : summaryLoading && !summary ? (
                <p className="text-sm text-muted">Counting matching rides...</p>
              ) : matchCount === 0 ? (
                <p className="text-sm text-muted">
                  No unassigned rides match your filters.
                </p>
              ) : (
                <>
                  <p className="text-sm text-white">
                    <span className="font-semibold text-primary">{matchCount}</span>{' '}
                    unassigned ride{matchCount !== 1 ? 's' : ''} will be assigned
                    {selectedBike && (
                      <> to <span className="font-medium">{getBikeName(selectedBike)}</span></>
                    )}
                  </p>
                  {/* The hours are the actual consequence: they land on this
                      bike's components and move its service predictions. */}
                  <p className="text-xs text-muted mt-1">
                    {dateSpan && <>{dateSpan}. </>}
                    About {matchHours} h credited to this bike's components.
                  </p>
                  {matchCount > MAX_RIDES_PER_PASS && (
                    <p className="text-xs text-muted mt-1">
                      Assigns the {MAX_RIDES_PER_PASS} most recent at a time. Run it again for
                      the rest.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-forest/20 text-forest text-sm">
                <CircleCheck size={14} />
                {successMessage}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/20 text-danger text-sm">
                <TriangleAlert size={14} />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAssign}
                disabled={!selectedBikeId || matchCount === 0 || isSubmitting || isInvalidDateRange}
              >
                {isSubmitting
                  ? progress
                    ? `Assigning ${progress.done} of ${progress.total}...`
                    : 'Assigning...'
                  : isCapped
                    ? `Assign ${passCount} of ${matchCount} Rides`
                    : `Assign ${matchCount} Ride${matchCount !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
