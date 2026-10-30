import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation } from '@apollo/client';
import { Check, Wrench, TriangleAlert } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LOG_SERVICE } from '../../graphql/logService';
import { BIKES } from '../../graphql/bikes';
import { formatComponentLabel, getBikeName } from '../../utils/formatters';
import { dateInputToIsoNoon, todayDateInput } from '../../lib/format';
import { useCurrency } from '../../hooks/useCurrency';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { StatusDot } from './StatusDot';
import { ServicePartsCostFields } from './ServicePartsCostFields';
import {
  partsSumMinor,
  partsToInput,
  type PartDraft,
} from '../../lib/serviceParts';
import { parseMoneyInput } from '../../lib/money';

interface LogServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: BikeWithPredictions | null;
  defaultComponentId?: string | null;
}

const MULTI_SELECT_HINT =
  'Select one part to record parts and cost, or add them later from the logbook.';

export function LogServiceModal({
  isOpen,
  onClose,
  bike,
  defaultComponentId,
}: LogServiceModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [serviceDate, setServiceDate] = useState(() =>
    todayDateInput()
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parts and cost. Entered only when exactly one component is selected: one
  // total across several parts cannot be attributed honestly.
  const defaultCurrency = useCurrency();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [costText, setCostText] = useState('');
  const [parts, setParts] = useState<PartDraft[]>([]);

  const [logService] = useMutation(LOG_SERVICE, {
    refetchQueries: [{ query: BIKES }],
  });

  // Sync selection and reset the form when the modal opens or defaultComponentId changes
  useEffect(() => {
    if (isOpen) {
      // Set initial selection based on defaultComponentId
      const initialSelection = defaultComponentId ? new Set([defaultComponentId]) : new Set<string>();
      setSelectedIds(initialSelection);
      setServiceDate(todayDateInput());
      setError(null);
      setDetailsOpen(false);
      setCurrency(defaultCurrency);
      setCostText('');
      setParts([]);
    }
  }, [isOpen, defaultComponentId, defaultCurrency]);

  const toggleComponent = useCallback((componentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
      }
      return next;
    });
  }, []);

  const components = useMemo(
    () => bike?.predictions?.components ?? [],
    [bike?.predictions?.components]
  );

  const singleSelected = selectedIds.size === 1;
  const selectedComponent = useMemo(() => {
    if (!singleSelected) return null;
    const [id] = Array.from(selectedIds);
    return components.find((c) => c.componentId === id) ?? null;
  }, [components, selectedIds, singleSelected]);

  const prefillMinor = useMemo(() => partsSumMinor(parts, currency), [parts, currency]);

  const handleSubmit = useCallback(async () => {
    if (selectedIds.size === 0) return;

    setIsSubmitting(true);
    setError(null);
    try {
      // Parts and cost ride along only on a single selection; several
      // components get the plain date-only log, as before.
      const partsInput = singleSelected ? partsToInput(parts, currency) : [];
      const costMinor = singleSelected
        ? costText.trim() === ''
          ? prefillMinor
          : parseMoneyInput(costText, currency)
        : null;
      const details =
        singleSelected && (costMinor != null || partsInput.length > 0)
          ? {
              ...(costMinor != null ? { costMinor } : {}),
              currency,
              ...(partsInput.length > 0 ? { parts: partsInput } : {}),
            }
          : {};

      // Log service for each selected component with the selected date
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          logService({
            variables: {
              input: {
                componentId: id,
                performedAt: dateInputToIsoNoon(serviceDate),
                ...details,
              },
            },
          })
        )
      );
      onClose();
    } catch (err) {
      console.error('Failed to log service:', err);
      setError('Failed to log service. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, singleSelected, parts, currency, costText, prefillMinor, serviceDate, logService, onClose]);

  const handleClose = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  if (!bike) return null;

  const bikeName = getBikeName(bike);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Log Service"
      size="md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={selectedIds.size === 0 || isSubmitting}
          >
            {isSubmitting ? 'Logging...' : `Log Service (${selectedIds.size})`}
          </Button>
        </>
      }
    >
      <div className="log-service-modal-content">
        <div className="log-service-modal-bike">
          <Wrench size={16} className="icon-sage" />
          <span className="log-service-modal-bike-name">{bikeName}</span>
        </div>

        <div className="log-service-date-section">
          <label className="log-service-date-label" htmlFor="service-date">
            Service date
          </label>
          <input
            id="service-date"
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            max={todayDateInput()}
            className="log-service-date-input"
          />
        </div>

        <ServicePartsCostFields
          idPrefix="log-service"
          open={detailsOpen}
          onToggle={() => setDetailsOpen((v) => !v)}
          disabled={!singleSelected}
          disabledHint={MULTI_SELECT_HINT}
          currency={currency}
          onCurrencyChange={setCurrency}
          costText={costText}
          onCostTextChange={setCostText}
          prefillMinor={prefillMinor}
          parts={parts}
          onPartsChange={setParts}
          component={selectedComponent}
        />

        <div>
          <p className="log-service-hint">
            Select components that were serviced:
          </p>

          <div className="log-service-checklist list-stagger">
            {components.map((component) => {
              const isSelected = selectedIds.has(component.componentId);
              return (
                <div
                  key={component.componentId}
                  className={`log-service-item ${isSelected ? 'log-service-item-selected' : ''}`}
                  onClick={() => toggleComponent(component.componentId)}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleComponent(component.componentId);
                    }
                  }}
                >
                  <div className="log-service-item-checkbox">
                    {isSelected && <Check size={10} className="icon-forest" />}
                  </div>
                  <StatusDot status={component.status} />
                  <span className="log-service-item-label">
                    {formatComponentLabel(component)}
                  </span>
                  <span className="log-service-item-hours">
                    {component.hoursRemaining != null
                      ? /* Clamped: hoursRemaining is negative for a component
                           past due. This is a pick-list for logging service, so
                           the row only has to identify the part; its status is
                           carried by the StatusDot above. */
                        `${Math.max(0, component.hoursRemaining).toFixed(1)} hrs`
                      : `${component.hoursSinceService.toFixed(1)}h since service`}
                  </span>
                </div>
              );
            })}
          </div>
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
