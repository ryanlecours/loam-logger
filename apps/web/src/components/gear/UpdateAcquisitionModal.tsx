import { useEffect, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Calendar, TriangleAlert } from 'lucide-react';

import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { UPDATE_BIKE_ACQUISITION } from '../../graphql/bike';
import { BIKES } from '../../graphql/bikes';
import { GEAR_QUERY_LIGHT } from '../../graphql/gear';
import { BIKE_HISTORY } from '../../graphql/bikeHistory';
import { dateInputToIsoNoon, isoToDateInput, todayDateInput } from '../../lib/format';

interface UpdateAcquisitionModalProps {
  bikeId: string;
  bikeName: string;
  currentAcquisitionDate?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function UpdateAcquisitionModal({
  bikeId,
  bikeName,
  currentAcquisitionDate,
  isOpen,
  onClose,
}: UpdateAcquisitionModalProps) {
  const [dateValue, setDateValue] = useState('');
  const [cascade, setCascade] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ installsMoved: number; serviceLogsMoved: number } | null>(
    null
  );

  const [updateAcquisition] = useMutation(UPDATE_BIKE_ACQUISITION, {
    refetchQueries: [
      { query: BIKES },
      { query: GEAR_QUERY_LIGHT },
      { query: BIKE_HISTORY, variables: { bikeId } },
    ],
  });

  useEffect(() => {
    if (isOpen) {
      // Prefer the bike's existing acquisitionDate as the starting point
      // (a user clearing up a recent typo shouldn't have to retype the
      // whole date). Falls back to today for first-time setters.
      setDateValue(isoToDateInput(currentAcquisitionDate) || todayDateInput());
      setCascade(true);
      setBusy(false);
      setError(null);
      setResult(null);
    }
  }, [isOpen, currentAcquisitionDate]);

  const handleConfirm = async () => {
    if (!dateValue) {
      setError('Pick a date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await updateAcquisition({
        variables: {
          bikeId,
          input: {
            acquisitionDate: dateInputToIsoNoon(dateValue),
            cascadeInstalls: cascade,
          },
        },
      });
      if (data?.updateBikeAcquisition) {
        setResult({
          installsMoved: data.updateBikeAcquisition.installsMoved,
          serviceLogsMoved: data.updateBikeAcquisition.serviceLogsMoved,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update acquisition date.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Update acquisition date"
      subtitle={bikeName}
      size="sm"
      footer={
        result ? (
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirm} disabled={busy}>
              {busy ? 'Updating…' : 'Update'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2">
          <p className="text-sm">
            Moved <span className="font-semibold">{result.installsMoved}</span> install date
            {result.installsMoved === 1 ? '' : 's'} to{' '}
            <span className="font-semibold">
              {new Date(dateInputToIsoNoon(dateValue)).toLocaleDateString()}
            </span>
            .
          </p>
          {result.serviceLogsMoved > 0 && (
            <p className="text-xs text-muted">
              Baseline service anchors for {result.serviceLogsMoved} component
              {result.serviceLogsMoved === 1 ? '' : 's'} moved alongside so wear predictions stay
              accurate.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-sm text-muted">
            <Calendar size={14} className="mt-0.5 shrink-0 icon-sage" />
            <span>
              Sets the acquisition date on this bike. If enabled below, also moves the install
              dates of every stock component (and any install that was auto-stamped when the bike
              was added).
            </span>
          </div>

          <div>
            <label htmlFor="acquisition-date" className="block text-xs text-muted mb-1">
              Acquired on
            </label>
            <input
              id="acquisition-date"
              type="date"
              value={dateValue}
              max={todayDateInput()}
              onChange={(e) => setDateValue(e.target.value)}
              className="log-service-date-input w-full"
            />
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Also update install dates for stock components
              <span className="block text-xs text-muted">
                Post-creation swaps you've dated yourself won't be touched.
              </span>
            </span>
          </label>

          {error && (
            <div className="alert-inline alert-inline-error">
              <TriangleAlert size={14} />
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
