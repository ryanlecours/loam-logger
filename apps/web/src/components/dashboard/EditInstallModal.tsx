import { useEffect, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Trash2, TriangleAlert, Wrench } from 'lucide-react';

import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  UPDATE_BIKE_COMPONENT_INSTALL,
  DELETE_BIKE_COMPONENT_INSTALL,
} from '../../graphql/componentInstall';
import { BIKES } from '../../graphql/bikes';
import { BIKE_HISTORY } from '../../graphql/bikeHistory';
import { GEAR_QUERY_LIGHT } from '../../graphql/gear';
import { dateInputToIsoNoon, isoToDateInput, todayDateInput } from '../../lib/format';

export interface EditableInstallEvent {
  /** Composite id from BikeHistory (e.g. "abc:installed" or "abc:removed"). */
  id: string;
  eventType: 'INSTALLED' | 'REMOVED';
  occurredAt: string;
}

interface EditInstallModalProps {
  event: EditableInstallEvent | null;
  componentLabel: string;
  bikeId?: string;
  /**
   * True when the underlying BikeComponentInstall row has BOTH installedAt
   * and removedAt — i.e. the timeline shows both an "Installed" and a
   * "Removed" entry for this component. Controls the delete-confirmation
   * copy so we don't claim "removes two events" on a component that was
   * never taken off the bike.
   */
  hasPairedEvent?: boolean;
  onClose: () => void;
}

function baseInstallId(compositeId: string): string {
  // The BikeHistory payload suffixes install row ids with ":installed" or
  // ":removed" so the two timeline rows have distinct keys. Strip the suffix
  // to talk to the underlying BikeComponentInstall row.
  const idx = compositeId.lastIndexOf(':');
  return idx > 0 ? compositeId.slice(0, idx) : compositeId;
}

export function EditInstallModal({
  event,
  componentLabel,
  bikeId,
  hasPairedEvent = false,
  onClose,
}: EditInstallModalProps) {
  const [dateValue, setDateValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const refetch = [
    { query: BIKES },
    { query: GEAR_QUERY_LIGHT },
    ...(bikeId ? [{ query: BIKE_HISTORY, variables: { bikeId } }] : []),
  ];

  const [updateInstall] = useMutation(UPDATE_BIKE_COMPONENT_INSTALL, { refetchQueries: refetch });
  const [deleteInstall] = useMutation(DELETE_BIKE_COMPONENT_INSTALL, { refetchQueries: refetch });

  useEffect(() => {
    if (event) {
      setDateValue(isoToDateInput(event.occurredAt));
      setError(null);
      setConfirmingDelete(false);
    }
  }, [event]);

  if (!event) return null;

  const isInstallEvent = event.eventType === 'INSTALLED';
  const fieldLabel = isInstallEvent ? 'Install date' : 'Removal date';

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const iso = dateValue ? dateInputToIsoNoon(dateValue) : undefined;
      if (!iso) {
        setError('Pick a valid date.');
        setBusy(false);
        return;
      }
      const input = isInstallEvent ? { installedAt: iso } : { removedAt: iso };
      await updateInstall({
        variables: { id: baseInstallId(event.id), input },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteInstall({
        variables: { id: baseInstallId(event.id) },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isInstallEvent ? 'Edit Install' : 'Edit Removal'}
      size="sm"
      footer={
        <div className="flex items-center justify-between w-full">
          {!confirmingDelete ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              <Trash2 size={12} className="icon-left" />
              Delete entry
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">
                {hasPairedEvent
                  ? 'Delete both the install and removal events?'
                  : 'Delete this install event?'}
              </span>
              <Button variant="primary" size="sm" onClick={handleDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={busy || confirmingDelete}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Wrench size={14} className="icon-sage" />
          <span className="font-medium">{componentLabel}</span>
        </div>

        <p className="text-xs text-muted">
          {hasPairedEvent
            ? 'Deleting this entry removes both the install and removal events for this component.'
            : 'Deleting this entry removes the install record for this component.'}
        </p>

        <div>
          <label htmlFor="edit-install-date" className="block text-xs text-muted mb-1">
            {fieldLabel}
          </label>
          <input
            id="edit-install-date"
            type="date"
            value={dateValue}
            max={todayDateInput()}
            onChange={(e) => setDateValue(e.target.value)}
            className="log-service-date-input w-full"
          />
        </div>

        {error && (
          <div className="alert-inline alert-inline-error">
            <TriangleAlert size={14} />
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
