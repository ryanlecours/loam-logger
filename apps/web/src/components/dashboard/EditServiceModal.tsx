import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@apollo/client';
import { Trash2, TriangleAlert, Wrench } from 'lucide-react';

import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { UPDATE_SERVICE_LOG, DELETE_SERVICE_LOG } from '../../graphql/serviceLog';
import { BIKES } from '../../graphql/bikes';
import { BIKE_HISTORY } from '../../graphql/bikeHistory';
import { dateInputToIsoNoon, isoToDateInput, todayDateInput } from '../../lib/format';
import { moneyInputText, parseMoneyInput } from '../../lib/money';
import { useCurrency } from '../../hooks/useCurrency';
import { ServicePartsCostFields } from './ServicePartsCostFields';
import {
  partsFromLog,
  partsSumMinor,
  partsToInput,
  type PartDraft,
} from '../../lib/serviceParts';

export interface EditableServiceLog {
  id: string;
  performedAt: string;
  notes?: string | null;
  hoursAtService: number;
  /** Total spent, in minor units of `currency`. Null when not recorded. */
  costMinor?: number | null;
  currency?: string | null;
  /**
   * Parts fitted. Leave undefined when the caller did not fetch them: the
   * modal then never sends a replace-all list that would wipe them.
   */
  parts?: Array<{ id?: string; brand: string; model: string; priceMinor?: number | null; vendor?: string | null }>;
}

interface EditServiceModalProps {
  log: EditableServiceLog | null;
  componentLabel: string;
  bikeId?: string;
  /** The component's own brand and model, for the replacement hint. */
  component?: { brand?: string | null; model?: string | null } | null;
  onClose: () => void;
}

export function EditServiceModal({ log, componentLabel, bikeId, component, onClose }: EditServiceModalProps) {
  const [performedAt, setPerformedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const defaultCurrency = useCurrency();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [costText, setCostText] = useState('');
  const [parts, setParts] = useState<PartDraft[]>([]);

  const refetch = [
    { query: BIKES },
    ...(bikeId ? [{ query: BIKE_HISTORY, variables: { bikeId } }] : []),
  ];

  const [updateServiceLog] = useMutation(UPDATE_SERVICE_LOG, { refetchQueries: refetch });
  const [deleteServiceLog] = useMutation(DELETE_SERVICE_LOG, { refetchQueries: refetch });

  useEffect(() => {
    if (log) {
      setPerformedAt(isoToDateInput(log.performedAt));
      setNotes(log.notes ?? '');
      setHours(String(log.hoursAtService ?? 0));
      setError(null);
      setConfirmingDelete(false);
      const cur = log.currency ?? defaultCurrency;
      setCurrency(cur);
      setCostText(moneyInputText(log.costMinor ?? null, cur));
      setParts(partsFromLog(log.parts ?? [], cur));
      // Open when there is something to see, closed otherwise.
      setDetailsOpen(log.costMinor != null || (log.parts?.length ?? 0) > 0);
    }
  }, [log, defaultCurrency]);

  const prefillMinor = useMemo(() => partsSumMinor(parts, currency), [parts, currency]);

  if (!log) return null;

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const hoursNum = Number(hours);
      if (!Number.isFinite(hoursNum) || hoursNum < 0) {
        setError('Hours must be a non-negative number.');
        setBusy(false);
        return;
      }

      // Cost and parts go only when they changed. Parts are replace-all on
      // the server, so an unchanged list is left out entirely.
      const effectiveCost = costText.trim() === '' ? prefillMinor : parseMoneyInput(costText, currency);
      const originalCost = log.costMinor ?? null;
      const originalCurrency = log.currency ?? defaultCurrency;
      const nextParts = partsToInput(parts, currency);
      const originalParts = partsToInput(partsFromLog(log.parts ?? [], originalCurrency), originalCurrency);
      const partsChanged = JSON.stringify(nextParts) !== JSON.stringify(originalParts);
      const costChanged = effectiveCost !== originalCost;
      const currencyChanged =
        currency !== originalCurrency && (effectiveCost != null || nextParts.length > 0);
      const canSendParts = log.parts !== undefined || nextParts.length > 0;

      await updateServiceLog({
        variables: {
          id: log.id,
          input: {
            performedAt: dateInputToIsoNoon(performedAt),
            notes: notes.trim() || null,
            // Sending hours makes them the rider's declared reading, which
            // stops following ride history. Only send them when they changed.
            ...(hoursNum !== (log.hoursAtService ?? 0) ? { hoursAtService: hoursNum } : {}),
            // Null clears the cost.
            ...(costChanged || currencyChanged ? { costMinor: effectiveCost, currency } : {}),
            ...((partsChanged || currencyChanged) && canSendParts ? { parts: nextParts, currency } : {}),
          },
        },
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
      await deleteServiceLog({ variables: { id: log.id } });
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
      title="Edit Service"
      size="md"
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
              Delete
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Delete this service?</span>
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

        <div>
          <label htmlFor="edit-service-date" className="block text-xs text-muted mb-1">
            Service date
          </label>
          <input
            id="edit-service-date"
            type="date"
            value={performedAt}
            onChange={(e) => setPerformedAt(e.target.value)}
            max={todayDateInput()}
            className="log-service-date-input w-full"
          />
        </div>

        <ServicePartsCostFields
          idPrefix="edit-service"
          open={detailsOpen}
          onToggle={() => setDetailsOpen((v) => !v)}
          currency={currency}
          onCurrencyChange={setCurrency}
          costText={costText}
          onCostTextChange={setCostText}
          prefillMinor={prefillMinor}
          parts={parts}
          onPartsChange={setParts}
          component={component}
        />

        <div>
          <label htmlFor="edit-service-hours" className="block text-xs text-muted mb-1">
            Hours at service
          </label>
          <input
            id="edit-service-hours"
            type="number"
            step="0.1"
            min="0"
            // Matches the server-side MAX_SERVICE_HOURS cap in resolvers.ts.
            // Keeps the browser validation in sync so users get immediate
            // feedback instead of a round-trip error.
            max="100000"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-full rounded-md border border-app bg-surface px-3 py-2 text-sm text-app focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest"
          />
        </div>

        <div>
          <label htmlFor="edit-service-notes" className="block text-xs text-muted mb-1">
            Notes
          </label>
          <textarea
            id="edit-service-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-app bg-surface px-3 py-2 text-sm text-app placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest resize-none"
            placeholder="Optional notes about this service"
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
