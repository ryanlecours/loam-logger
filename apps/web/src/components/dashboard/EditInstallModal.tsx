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
  onClose: () => void;
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function baseInstallId(compositeId: string): string {
  // The BikeHistory payload suffixes install row ids with ":installed" or
  // ":removed" so the two timeline rows have distinct keys. Strip the suffix
  // to talk to the underlying BikeComponentInstall row.
  const idx = compositeId.lastIndexOf(':');
  return idx > 0 ? compositeId.slice(0, idx) : compositeId;
}

export function EditInstallModal({ event, componentLabel, bikeId, onClose }: EditInstallModalProps) {
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
      setDateValue(toDateInput(event.occurredAt));
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
      const iso = dateValue ? new Date(dateValue).toISOString() : undefined;
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
                Delete both the install and removal events?
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
          This will remove both the install and removal events for this component.
        </p>

        <div>
          <label htmlFor="edit-install-date" className="block text-xs text-muted mb-1">
            {fieldLabel}
          </label>
          <input
            id="edit-install-date"
            type="date"
            value={dateValue}
            max={new Date().toISOString().split('T')[0]}
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
