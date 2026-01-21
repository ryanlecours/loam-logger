import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { FaCheck, FaBicycle, FaExclamationTriangle, FaCheckCircle } from 'react-icons/fa';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { BIKES } from '../graphql/bikes';
import {
  useUnassignedRides,
  useAcknowledgeImportOverlay,
  useAssignBikeToRides,
  type UnassignedRide,
} from '../graphql/importSession';
import { getBikeName } from '../utils/formatters';
import { formatDistanceCompact, formatDurationCompact, formatDate } from '../utils/formatters';
import type { BikeWithPredictions } from '../hooks/usePriorityBike';

/** Minimal bike fields needed for the overlay */
type Bike = Pick<BikeWithPredictions, 'id' | 'nickname' | 'manufacturer' | 'model'>;

interface ImportCompleteOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  unassignedRideCount: number;
  totalImportedCount: number;
  /** Optional bikes prop to avoid redundant query when parent already has bikes */
  bikes?: Bike[];
}

export function ImportCompleteOverlay({
  isOpen,
  onClose,
  sessionId,
  unassignedRideCount,
  totalImportedCount,
  bikes: bikesProp,
}: ImportCompleteOverlayProps) {
  const [selectedBikeId, setSelectedBikeId] = useState<string>('');
  const [selectedRideIds, setSelectedRideIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Use bikes from prop if provided, otherwise query (for standalone usage)
  const { data: bikesData } = useQuery<{ bikes: Bike[] }>(BIKES, {
    skip: !!bikesProp, // Skip query if bikes provided via prop
  });
  const { data: ridesData, refetch: refetchRides } = useUnassignedRides(sessionId, 50);
  const [acknowledgeOverlay] = useAcknowledgeImportOverlay();
  const [assignBikeToRides] = useAssignBikeToRides();

  const bikes = useMemo(() => bikesProp ?? bikesData?.bikes ?? [], [bikesProp, bikesData?.bikes]);
  const rides = useMemo(() => ridesData?.unassignedRides?.rides ?? [], [ridesData?.unassignedRides?.rides]);
  const hasRides = rides.length > 0;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedRideIds(new Set());
      setError(null);
      setSuccessMessage(null);
      // Default to first bike if user has only one
      if (bikes.length === 1) {
        setSelectedBikeId(bikes[0].id);
      } else {
        setSelectedBikeId('');
      }
    }
  }, [isOpen, bikes.length, bikes]);

  const toggleRide = useCallback((rideId: string) => {
    setSelectedRideIds((prev) => {
      const next = new Set(prev);
      if (next.has(rideId)) {
        next.delete(rideId);
      } else {
        next.add(rideId);
      }
      return next;
    });
    setSuccessMessage(null);
  }, []);

  const selectAllRides = useCallback(() => {
    setSelectedRideIds(new Set(rides.map((r) => r.id)));
    setSuccessMessage(null);
  }, [rides]);

  const deselectAllRides = useCallback(() => {
    setSelectedRideIds(new Set());
    setSuccessMessage(null);
  }, []);

  const allSelected = useMemo(() => {
    return rides.length > 0 && selectedRideIds.size === rides.length;
  }, [rides.length, selectedRideIds.size]);

  const handleApplyToAll = useCallback(async () => {
    if (!selectedBikeId || !sessionId) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const allRideIds = rides.map((r) => r.id);
      await assignBikeToRides({ variables: { rideIds: allRideIds, bikeId: selectedBikeId } });
      setSuccessMessage(`Assigned ${allRideIds.length} rides to bike!`);
      setSelectedRideIds(new Set());
      // Refetch in background - assignment succeeded, so don't fail the whole operation
      refetchRides().catch((err) => {
        console.warn('Failed to refetch rides after assignment:', err);
      });
    } catch {
      setError('Failed to assign rides. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedBikeId, sessionId, rides, assignBikeToRides, refetchRides]);

  const handleApplyToSelected = useCallback(async () => {
    if (!selectedBikeId || selectedRideIds.size === 0) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const rideIds = Array.from(selectedRideIds);
      await assignBikeToRides({ variables: { rideIds, bikeId: selectedBikeId } });
      setSuccessMessage(`Assigned ${rideIds.length} rides to bike!`);
      setSelectedRideIds(new Set());
      // Refetch in background - assignment succeeded, so don't fail the whole operation
      refetchRides().catch((err) => {
        console.warn('Failed to refetch rides after assignment:', err);
      });
    } catch {
      setError('Failed to assign rides. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedBikeId, selectedRideIds, assignBikeToRides, refetchRides]);

  const handleDismiss = useCallback(async () => {
    if (!sessionId) {
      onClose();
      return;
    }

    // Acknowledge in background - failure doesn't affect user experience
    acknowledgeOverlay({ variables: { importSessionId: sessionId } }).catch((err) => {
      console.warn('Failed to acknowledge import overlay:', err);
    });
    onClose();
  }, [sessionId, acknowledgeOverlay, onClose]);

  if (!sessionId) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDismiss}
      title="Import Complete"
      subtitle={
        hasRides
          ? `${unassignedRideCount} of ${totalImportedCount} imported rides need a bike assigned`
          : 'All rides have been assigned!'
      }
      size="lg"
    >
      <div className="import-overlay-content">
        {bikes.length === 0 ? (
          <div className="import-overlay-no-bikes">
            <FaBicycle size={32} className="icon-muted" />
            <p>You don't have any bikes yet.</p>
            <p className="text-muted">Add a bike from the Dashboard to assign rides.</p>
          </div>
        ) : hasRides ? (
          <>
            {/* Bike Selector */}
            <div className="import-overlay-bike-select">
              <label htmlFor="bike-select" className="import-overlay-label">
                Select a bike
              </label>
              <select
                id="bike-select"
                value={selectedBikeId}
                onChange={(e) => {
                  setSelectedBikeId(e.target.value);
                  setSuccessMessage(null);
                }}
                className="form-select"
              >
                <option value="">Choose a bike...</option>
                {bikes.map((bike) => (
                  <option key={bike.id} value={bike.id}>
                    {getBikeName(bike)}
                  </option>
                ))}
              </select>
            </div>

            {/* Apply to All Button */}
            <div className="import-overlay-apply-all">
              <Button
                variant="primary"
                onClick={handleApplyToAll}
                disabled={!selectedBikeId || isSubmitting || rides.length === 0}
              >
                {isSubmitting ? 'Assigning...' : `Apply to All (${rides.length})`}
              </Button>
            </div>

            <div className="import-overlay-divider">
              <span>or select specific rides</span>
            </div>

            {/* Rides List */}
            <div className="import-overlay-rides-header">
              <button
                type="button"
                className="import-overlay-select-toggle"
                onClick={allSelected ? deselectAllRides : selectAllRides}
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="import-overlay-rides-list">
              {rides.map((ride) => (
                <RideRow
                  key={ride.id}
                  ride={ride}
                  isSelected={selectedRideIds.has(ride.id)}
                  onToggle={() => toggleRide(ride.id)}
                />
              ))}
            </div>

            {/* Apply to Selected Button */}
            {selectedRideIds.size > 0 && (
              <div className="import-overlay-apply-selected">
                <Button
                  variant="secondary"
                  onClick={handleApplyToSelected}
                  disabled={!selectedBikeId || isSubmitting}
                >
                  {isSubmitting ? 'Assigning...' : `Apply to Selected (${selectedRideIds.size})`}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="import-overlay-all-done">
            <FaCheckCircle size={48} className="icon-forest" />
            <p>All rides have been assigned to bikes!</p>
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="alert-inline alert-inline-success">
            <FaCheckCircle size={14} />
            {successMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="alert-inline alert-inline-error">
            <FaExclamationTriangle size={14} />
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="import-overlay-actions">
          <Button variant="outline" onClick={handleDismiss}>
            {hasRides ? 'Dismiss' : 'Close'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RideRow({
  ride,
  isSelected,
  onToggle,
}: {
  ride: UnassignedRide;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const date = new Date(ride.startTime);
  const formattedDate = formatDate(date, 'short');
  const duration = formatDurationCompact(ride.durationSeconds);
  const distance = formatDistanceCompact(ride.distanceMiles);

  const ariaLabel = `${ride.rideType} ride on ${formattedDate}, ${duration}, ${distance}${ride.location ? `, ${ride.location}` : ''}`;

  return (
    <div
      className={`import-overlay-ride-row ${isSelected ? 'import-overlay-ride-row-selected' : ''}`}
      onClick={onToggle}
      role="checkbox"
      aria-checked={isSelected}
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="import-overlay-ride-checkbox">
        {isSelected && <FaCheck size={10} className="icon-forest" />}
      </div>
      <div className="import-overlay-ride-info">
        <span className="import-overlay-ride-date">{formattedDate}</span>
        <span className="import-overlay-ride-details">
          {duration} · {distance}
          {ride.location && ` · ${ride.location}`}
        </span>
      </div>
      <span className="import-overlay-ride-type">{ride.rideType}</span>
    </div>
  );
}
