import { useState, useMemo, useCallback, useEffect } from 'react';
import { FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useAssignBikeToRides } from '../graphql/importSession';
import { getRideSource, SOURCE_LABELS, type RideSource } from '../utils/rideSource';
import { getBikeName } from '../utils/formatters';
import type { Ride } from '../models/Ride';

type Bike = {
  id: string;
  nickname?: string | null;
  manufacturer: string;
  model: string;
};

type ProviderFilter = 'all' | RideSource;

interface MassAssignBikeModalProps {
  isOpen: boolean;
  onClose: () => void;
  rides: Ride[];
  bikes: Bike[];
  onSuccess?: () => void;
}

export function MassAssignBikeModal({
  isOpen,
  onClose,
  rides,
  bikes,
  onSuccess,
}: MassAssignBikeModalProps) {
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [assignBikeToRides] = useAssignBikeToRides();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedBikeId(bikes.length === 1 ? bikes[0].id : '');
      setStartDate('');
      setEndDate('');
      setProviderFilter('all');
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, bikes]);

  // Filter rides based on user selections
  const filteredRides = useMemo(() => {
    return rides.filter((ride) => {
      // Must be unassigned
      if (ride.bikeId) return false;

      // Date range filter
      // Append time component to avoid timezone parsing inconsistencies with YYYY-MM-DD format
      if (startDate) {
        const rideDate = new Date(ride.startTime);
        const filterStart = new Date(startDate + 'T00:00:00');
        if (rideDate < filterStart) return false;
      }

      if (endDate) {
        const rideDate = new Date(ride.startTime);
        const filterEnd = new Date(endDate + 'T23:59:59.999');
        if (rideDate > filterEnd) return false;
      }

      // Provider filter
      if (providerFilter !== 'all') {
        const source = getRideSource(ride);
        if (source !== providerFilter) return false;
      }

      return true;
    });
  }, [rides, startDate, endDate, providerFilter]);

  const handleAssign = useCallback(async () => {
    if (!selectedBikeId || filteredRides.length === 0) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const rideIds = filteredRides.map((r) => r.id);
      const result = await assignBikeToRides({
        variables: { rideIds, bikeId: selectedBikeId },
      });

      const updatedCount = result.data?.assignBikeToRides?.updatedCount ?? rideIds.length;
      setSuccessMessage(`Assigned ${updatedCount} ride${updatedCount !== 1 ? 's' : ''} to bike!`);

      // Call onSuccess to trigger refetch in parent
      onSuccess?.();
    } catch (err) {
      console.error('Failed to assign bikes:', err);
      setError('Failed to assign rides. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedBikeId, filteredRides, assignBikeToRides, onSuccess]);

  const providerOptions: { value: ProviderFilter; label: string }[] = [
    { value: 'all', label: 'All providers' },
    { value: 'strava', label: SOURCE_LABELS.strava },
    { value: 'garmin', label: SOURCE_LABELS.garmin },
    { value: 'whoop', label: SOURCE_LABELS.whoop },
    { value: 'manual', label: SOURCE_LABELS.manual },
  ];

  const selectedBike = bikes.find((b) => b.id === selectedBikeId);

  // Validate date range (start should not be after end)
  const isInvalidDateRange = !!(startDate && endDate && new Date(startDate) > new Date(endDate));

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
              ) : filteredRides.length === 0 ? (
                <p className="text-sm text-muted">
                  No unassigned rides match your filters.
                </p>
              ) : (
                <p className="text-sm text-white">
                  <span className="font-semibold text-primary">{filteredRides.length}</span>{' '}
                  unassigned ride{filteredRides.length !== 1 ? 's' : ''} will be assigned
                  {selectedBike && (
                    <> to <span className="font-medium">{getBikeName(selectedBike)}</span></>
                  )}
                </p>
              )}
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-forest/20 text-forest text-sm">
                <FaCheckCircle size={14} />
                {successMessage}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/20 text-danger text-sm">
                <FaExclamationTriangle size={14} />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAssign}
                disabled={!selectedBikeId || filteredRides.length === 0 || isSubmitting || isInvalidDateRange}
              >
                {isSubmitting ? 'Assigning...' : `Assign ${filteredRides.length} Ride${filteredRides.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
