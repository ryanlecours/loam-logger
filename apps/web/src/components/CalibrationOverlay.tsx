import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { BellOff, Bike, Check, ChevronDown, ChevronUp, TriangleAlert, CircleCheck } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { StatusDot } from './dashboard/StatusDot';
import {
  useCalibrationState,
  useLogBulkService,
  useDismissCalibration,
  useCompleteCalibration,
  useSnoozeComponent,
  type BikeCalibrationInfo,
} from '../graphql/calibration';
import { formatComponentLabel } from '../utils/formatters';
import type { ComponentPrediction, PredictionStatus } from '../types/prediction';

interface CalibrationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

// Format month/year to YYYY-MM for input type="month"
function formatMonthValue(month: number, year: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// Parse YYYY-MM value from input type="month"
function parseMonthValue(value: string): { month: number; year: number } {
  const [yearStr, monthStr] = value.split('-');
  return { month: parseInt(monthStr, 10) - 1, year: parseInt(yearStr, 10) };
}

// Get min/max for month input (10 years ago to current month)
function getMonthInputBounds(): { min: string; max: string } {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  return {
    min: formatMonthValue(0, currentYear - 10),
    max: formatMonthValue(currentMonth, currentYear),
  };
}

// "Needs attention" matches the criterion the calibrationState resolver uses
// to decide which bikes trigger the overlay. The resolver now returns all
// components on those bikes (not just needs-attention ones), so this helper
// is what the frontend uses to badge, sort, pre-select, and gate the
// completion counter. Keep in sync with apps/api/src/graphql/resolvers.ts.
function isNeedsAttention(status: string): boolean {
  return status === 'OVERDUE' || status === 'DUE_NOW';
}

// Sort key used to render OVERDUE/DUE_NOW rows above DUE_SOON/ALL_GOOD ones
// once the components array contains all statuses. Lower = earlier in list.
const STATUS_PRIORITY: Record<string, number> = {
  OVERDUE: 0,
  DUE_NOW: 1,
  DUE_SOON: 2,
  ALL_GOOD: 3,
};

export function CalibrationOverlay({ isOpen, onClose }: CalibrationOverlayProps) {
  const { data } = useCalibrationState();
  const [logBulkService] = useLogBulkService();
  const [dismissCalibration] = useDismissCalibration();
  const [completeCalibration] = useCompleteCalibration();
  const [snoozeComponent] = useSnoozeComponent();

  // Track which components have been calibrated (by componentId)
  const [calibratedIds, setCalibratedIds] = useState<Set<string>>(new Set());
  // Track expanded bike section (only one at a time, accordion style)
  const [expandedBikeId, setExpandedBikeId] = useState<string | null>(null);
  // Track bulk action date per bike
  const [bulkDates, setBulkDates] = useState<Record<string, { month: number; year: number }>>({});
  // Track selected components per bike for bulk action
  const [selectedComponents, setSelectedComponents] = useState<Record<string, Set<string>>>({});
  // Snapshot of components flagged "needs attention" at modal open. Drives the
  // progress denominator and the bike-section badge so adding a historical
  // service for an ALL_GOOD component doesn't inflate the "X need attention"
  // count. Stable for the life of the modal (not refetched mid-session).
  const [needsAttentionIds, setNeedsAttentionIds] = useState<Set<string>>(new Set());
  // Track initial total for progress (captured when modal opens, doesn't change on refetch)
  const [initialTotal, setInitialTotal] = useState(0);
  // Track pending service logs to batch submit on completion (componentId -> performedAt)
  const [pendingServiceLogs, setPendingServiceLogs] = useState<Map<string, string>>(new Map());
  // Per-row inline Log Service flow. Only one row may have its inline date
  // picker open at a time; second open replaces the first. `inlineDate` holds
  // the month/year currently in the picker for that row.
  const [inlineDateComponentId, setInlineDateComponentId] = useState<string | null>(null);
  const [inlineDate, setInlineDate] = useState<{ month: number; year: number } | null>(null);
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const calibrationState = data?.calibrationState;
  // `useCalibrationState` uses `cache-and-network`, so Apollo can hand us a
  // fresh `calibrationState` reference mid-session — a background refetch,
  // or a `refetchQueries: [CALIBRATION_STATE]` fired by a sibling mutation.
  // We snapshot the bikes into state ONCE per modal-open (see the init
  // effect below) and render/handle off that frozen copy, so an async
  // refetch can't wipe the user's in-progress pendingServiceLogs /
  // calibratedIds / inline-picker state out from under them.
  const [bikes, setBikes] = useState<BikeCalibrationInfo[]>([]);
  // Guards the init effect so it runs exactly once per modal-open, not on
  // every `calibrationState` reference change.
  const hasInitializedRef = useRef(false);

  // Calculate progress using initial total (stable across refetches).
  // Progress denominator is "needs-attention components at open" so the
  // user logging an extra historical service on a healthy DUE_SOON
  // component doesn't push remainingCount negative.
  const calibratedNeedsAttentionCount = useMemo(
    () => Array.from(calibratedIds).filter((id) => needsAttentionIds.has(id)).length,
    [calibratedIds, needsAttentionIds],
  );
  const remainingCount = Math.max(0, initialTotal - calibratedNeedsAttentionCount);

  // Snapshot + initialize state once per modal-open.
  //
  // Deliberately gated by `hasInitializedRef` rather than re-running on every
  // `bikes` change: the query is `cache-and-network`, so a background refetch
  // (or a sibling mutation's `refetchQueries`) lands a new `calibrationState`
  // reference mid-session. Re-running this effect on that would reset
  // `pendingServiceLogs`, `calibratedIds`, and the inline-picker state —
  // silently discarding everything the user has staged before they hit
  // "Complete Calibration." Snapshot once; ignore later refetches.
  useEffect(() => {
    if (!isOpen) {
      // Modal closed — clear the guard so the next open re-snapshots fresh data.
      hasInitializedRef.current = false;
      return;
    }
    if (hasInitializedRef.current) return;
    // Wait for the query to resolve (from cache or network) before snapshotting.
    if (!calibrationState) return;
    hasInitializedRef.current = true;

    const snapshot = calibrationState.bikes ?? [];
    setBikes(snapshot);

    setCalibratedIds(new Set());
    setPendingServiceLogs(new Map());
    setInlineDateComponentId(null);
    setInlineDate(null);
    setError(null);
    setSuccessMessage(null);

    // Initial total / pre-selection / bike-section badge all key off the
    // needs-attention subset, NOT the full components array. The resolver
    // returns every component on bikes that have at least one overdue
    // item — without filtering here, the "5 components need attention"
    // subtitle would balloon into the full bike inventory.
    const attentionIds = new Set<string>();
    snapshot.forEach((bike) => {
      bike.components.forEach((c) => {
        if (isNeedsAttention(c.status)) attentionIds.add(c.componentId);
      });
    });
    setNeedsAttentionIds(attentionIds);
    setInitialTotal(attentionIds.size);

    if (snapshot.length > 0) {
      setExpandedBikeId(snapshot[0].bikeId);
    }
    const now = new Date();
    const initialDates: Record<string, { month: number; year: number }> = {};
    const initialSelected: Record<string, Set<string>> = {};
    snapshot.forEach((bike) => {
      initialDates[bike.bikeId] = { month: now.getMonth(), year: now.getFullYear() };
      // Pre-select needs-attention rows only — that's the most common
      // intent ("I just serviced everything that's overdue"). Users can
      // uncheck or extend selection manually.
      initialSelected[bike.bikeId] = new Set(
        bike.components
          .filter((c) => isNeedsAttention(c.status))
          .map((c) => c.componentId),
      );
    });
    setBulkDates(initialDates);
    setSelectedComponents(initialSelected);
  }, [isOpen, calibrationState]);

  const toggleBikeExpanded = useCallback((bikeId: string) => {
    setExpandedBikeId((prev) => (prev === bikeId ? null : bikeId));
  }, []);

  const toggleComponentSelection = useCallback((bikeId: string, componentId: string) => {
    setSelectedComponents((prev) => {
      const bikeSelected = prev[bikeId] ?? new Set<string>();
      const next = new Set(bikeSelected);
      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
      }
      return { ...prev, [bikeId]: next };
    });
  }, []);

  const toggleAllComponents = useCallback((bikeId: string, components: ComponentPrediction[], selectAll: boolean) => {
    setSelectedComponents((prev) => {
      const uncalibrated = components.filter((c) => !calibratedIds.has(c.componentId));
      const next = selectAll
        ? new Set(uncalibrated.map((c) => c.componentId))
        : new Set<string>();
      return { ...prev, [bikeId]: next };
    });
  }, [calibratedIds]);

  const handleBulkServiceDate = useCallback((bikeId: string) => {
    const bike = bikes.find((b) => b.bikeId === bikeId);
    if (!bike) return;

    const dateInfo = bulkDates[bikeId];
    if (!dateInfo) return;

    // Get selected uncalibrated components for this bike
    const bikeSelected = selectedComponents[bikeId] ?? new Set<string>();
    const selectedUncalibrated = bike.components.filter(
      (c) => bikeSelected.has(c.componentId) && !calibratedIds.has(c.componentId)
    );
    if (selectedUncalibrated.length === 0) return;

    // Create ISO date string (1st of the selected month)
    const performedAt = new Date(dateInfo.year, dateInfo.month, 1).toISOString();
    const componentIds = selectedUncalibrated.map((c) => c.componentId);

    // Add to pending logs (will be submitted on completion)
    setPendingServiceLogs((prev) => {
      const next = new Map(prev);
      componentIds.forEach((id) => next.set(id, performedAt));
      return next;
    });

    // Mark these components as calibrated locally
    setCalibratedIds((prev) => {
      const next = new Set(prev);
      componentIds.forEach((id) => next.add(id));
      return next;
    });

    // Clear selection for calibrated components
    setSelectedComponents((prev) => {
      const bikeSet = prev[bikeId] ?? new Set<string>();
      const next = new Set(bikeSet);
      componentIds.forEach((id) => next.delete(id));
      return { ...prev, [bikeId]: next };
    });

    setSuccessMessage(`Marked ${componentIds.length} component${componentIds.length === 1 ? '' : 's'} as serviced`);
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [bikes, bulkDates, selectedComponents, calibratedIds]);

  const handleSnooze = useCallback(async (componentId: string) => {
    // Snooze extends the service interval by 50% (visual inspection, component is fine)
    try {
      await snoozeComponent({ variables: { id: componentId } });

      // Mark as calibrated locally
      setCalibratedIds((prev) => new Set([...prev, componentId]));

      setSuccessMessage('Service interval extended by 50%');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to snooze component:', err);
      setError('Failed to snooze component');
      setTimeout(() => setError(null), 3000);
    }
  }, [snoozeComponent]);

  const handleAcknowledge = useCallback((componentId: string) => {
    // Mark as calibrated without logging a service (hours are accurate, just never serviced)
    setCalibratedIds((prev) => new Set([...prev, componentId]));

    setSuccessMessage('Hours acknowledged');
    setTimeout(() => setSuccessMessage(null), 3000);
  }, []);

  // Per-row Log Service flow. Opens an inline month picker on a single
  // component row. Confirming pushes the (componentId, performedAt) pair
  // into pendingServiceLogs — the same Map the bulk flow uses — so a single
  // LOG_BULK_SERVICE call on handleComplete persists everything together.
  const handleOpenInlineLogService = useCallback((componentId: string) => {
    setInlineDateComponentId(componentId);
    const now = new Date();
    setInlineDate({ month: now.getMonth(), year: now.getFullYear() });
  }, []);

  const handleCancelInlineLogService = useCallback(() => {
    setInlineDateComponentId(null);
    setInlineDate(null);
  }, []);

  const handleConfirmInlineLogService = useCallback((componentId: string) => {
    if (!inlineDate) return;
    const performedAt = new Date(inlineDate.year, inlineDate.month, 1).toISOString();

    setPendingServiceLogs((prev) => {
      const next = new Map(prev);
      next.set(componentId, performedAt);
      return next;
    });
    setCalibratedIds((prev) => new Set([...prev, componentId]));
    // Clean up inline picker state and any lingering bulk-selection for
    // this component so it doesn't double-count if the bulk button fires.
    setInlineDateComponentId(null);
    setInlineDate(null);
    setSelectedComponents((prev) => {
      const updated: Record<string, Set<string>> = {};
      for (const [bikeId, ids] of Object.entries(prev)) {
        if (ids.has(componentId)) {
          const next = new Set(ids);
          next.delete(componentId);
          updated[bikeId] = next;
        } else {
          updated[bikeId] = ids;
        }
      }
      return updated;
    });

    setSuccessMessage('Service logged');
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [inlineDate]);

  // When the user changes a bike's bulk date AND no rows are currently
  // selected for that bike, auto-check the needs-attention rows. Removes
  // the discoverability tax for the most common flow ("I just serviced
  // the overdue stuff in <month>"). User can still uncheck individual
  // rows after the auto-fill.
  const handleBulkDateChange = useCallback((bikeId: string, month: number, year: number) => {
    setBulkDates((prev) => ({ ...prev, [bikeId]: { month, year } }));
    setSelectedComponents((prev) => {
      const existing = prev[bikeId];
      if (existing && existing.size > 0) return prev;
      const bike = bikes.find((b) => b.bikeId === bikeId);
      if (!bike) return prev;
      const next = new Set(
        bike.components
          .filter((c) => isNeedsAttention(c.status) && !calibratedIds.has(c.componentId))
          .map((c) => c.componentId),
      );
      return { ...prev, [bikeId]: next };
    });
  }, [bikes, calibratedIds]);

  const handleDismiss = useCallback(async () => {
    try {
      await dismissCalibration();
    } catch (err) {
      console.warn('Failed to dismiss calibration:', err);
    }
    onClose();
  }, [dismissCalibration, onClose]);

  const handleComplete = useCallback(async () => {
    // If there are pending service logs, submit them first
    if (pendingServiceLogs.size > 0) {
      setIsSubmitting(true);
      setError(null);

      try {
        // Group pending logs by performedAt date for efficient batching
        const logsByDate = new Map<string, string[]>();
        pendingServiceLogs.forEach((performedAt, componentId) => {
          const existing = logsByDate.get(performedAt) ?? [];
          existing.push(componentId);
          logsByDate.set(performedAt, existing);
        });

        // Submit each batch
        for (const [performedAt, componentIds] of logsByDate) {
          await logBulkService({
            variables: {
              input: { componentIds, performedAt },
            },
          });
        }
        // Note: Don't refetch here - let completeCalibration handle the final state update
        // to avoid race conditions with the showOverlay flag
      } catch (err) {
        setError('Failed to save calibration. Please try again.');
        console.error('Calibration submission error:', err);
        setIsSubmitting(false);
        return; // Don't close on error
      }

      setIsSubmitting(false);
    }

    try {
      await completeCalibration();
    } catch (err) {
      console.warn('Failed to complete calibration:', err);
    }
    onClose();
  }, [pendingServiceLogs, logBulkService, completeCalibration, onClose]);

  // Don't render if no calibration needed
  if (!calibrationState?.showOverlay && bikes.length === 0) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDismiss}
      title="Calibrate Your Components"
      subtitle={
        remainingCount > 0
          ? `${remainingCount} component${remainingCount === 1 ? '' : 's'} need${remainingCount === 1 ? 's' : ''} attention`
          : 'All components calibrated!'
      }
      size="lg"
      preventClose={isSubmitting}
    >
      <div className="calibration-overlay-content">
        {/* Progress bar — needs-attention-scoped so historical service logs
            on healthy DUE_SOON/ALL_GOOD components don't push the bar past
            100%. Those services still persist; they just don't count toward
            "have you addressed everything that's overdue?" */}
        <div className="calibration-progress">
          <div className="calibration-progress-bar">
            <div
              className="calibration-progress-fill"
              style={{ width: `${initialTotal > 0 ? (calibratedNeedsAttentionCount / initialTotal) * 100 : 0}%` }}
            />
          </div>
          <span className="calibration-progress-text">
            {calibratedNeedsAttentionCount} of {initialTotal} calibrated
          </span>
        </div>

        {/* Info message */}
        <div className="calibration-info">
          <p>
            We imported your ride history, but we need to know when components were last serviced
            to give accurate maintenance predictions.
          </p>
        </div>

        {/* Button explanation */}
        <div className="calibration-info-secondary">
          <p>
            <strong>Log Service</strong> — Record a date you serviced this component.<br />
            <strong>Acknowledge</strong> — Hours are accurate, no service performed yet.<br />
            <strong>Snooze</strong> — Visually inspected, extend interval by 50%.
          </p>
        </div>

        {/* Bike sections */}
        <div className="calibration-bikes">
          {bikes.map((bike) => (
            <BikeSection
              key={bike.bikeId}
              bike={bike}
              isExpanded={expandedBikeId === bike.bikeId}
              onToggleExpanded={() => toggleBikeExpanded(bike.bikeId)}
              calibratedIds={calibratedIds}
              selectedIds={selectedComponents[bike.bikeId] ?? new Set()}
              onToggleSelection={(componentId) => toggleComponentSelection(bike.bikeId, componentId)}
              onToggleAll={(selectAll) => toggleAllComponents(bike.bikeId, bike.components, selectAll)}
              bulkDate={bulkDates[bike.bikeId]}
              onBulkDateChange={(month, year) => handleBulkDateChange(bike.bikeId, month, year)}
              onBulkService={() => handleBulkServiceDate(bike.bikeId)}
              onSnoozeAlert={handleSnooze}
              onAcknowledge={handleAcknowledge}
              inlineDateComponentId={inlineDateComponentId}
              inlineDate={inlineDate}
              onOpenInlineLogService={handleOpenInlineLogService}
              onInlineDateChange={setInlineDate}
              onConfirmInlineLogService={handleConfirmInlineLogService}
              onCancelInlineLogService={handleCancelInlineLogService}
              isSubmitting={isSubmitting}
            />
          ))}
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="alert-inline alert-inline-success">
            <CircleCheck size={14} />
            {successMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="alert-inline alert-inline-error">
            <TriangleAlert size={14} />
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="calibration-actions">
          <Button variant="outline" onClick={handleDismiss} disabled={isSubmitting}>
            Remind Me Later
          </Button>
          <Button variant="primary" onClick={handleComplete} disabled={isSubmitting}>
            {remainingCount === 0 ? 'Done' : 'Complete Calibration'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface BikeSectionProps {
  bike: BikeCalibrationInfo;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  calibratedIds: Set<string>;
  selectedIds: Set<string>;
  onToggleSelection: (componentId: string) => void;
  onToggleAll: (selectAll: boolean) => void;
  bulkDate: { month: number; year: number } | undefined;
  onBulkDateChange: (month: number, year: number) => void;
  onBulkService: () => void;
  onSnoozeAlert: (componentId: string) => void;
  onAcknowledge: (componentId: string) => void;
  inlineDateComponentId: string | null;
  inlineDate: { month: number; year: number } | null;
  onOpenInlineLogService: (componentId: string) => void;
  onInlineDateChange: (date: { month: number; year: number } | null) => void;
  onConfirmInlineLogService: (componentId: string) => void;
  onCancelInlineLogService: () => void;
  isSubmitting: boolean;
}

function BikeSection({
  bike,
  isExpanded,
  onToggleExpanded,
  calibratedIds,
  selectedIds,
  onToggleSelection,
  onToggleAll,
  bulkDate,
  onBulkDateChange,
  onBulkService,
  onSnoozeAlert,
  onAcknowledge,
  inlineDateComponentId,
  inlineDate,
  onOpenInlineLogService,
  onInlineDateChange,
  onConfirmInlineLogService,
  onCancelInlineLogService,
  isSubmitting,
}: BikeSectionProps) {
  const uncalibratedComponents = bike.components.filter((c) => !calibratedIds.has(c.componentId));
  // "Needs attention" is the gate the overlay scopes itself to. After the
  // resolver change, `bike.components` includes DUE_SOON / ALL_GOOD too, so
  // we have to derive the badge from status, not from the array length.
  const needsAttentionCount = uncalibratedComponents.filter((c) => isNeedsAttention(c.status)).length;
  const allNeedsAttentionAddressed = needsAttentionCount === 0;
  // Distinct from `allNeedsAttentionAddressed`: this is true only when every
  // component (healthy ones included) has been calibrated. Used to collapse
  // the section's content entirely — nothing left to act on or confirm.
  const allComponentsCalibrated = uncalibratedComponents.length === 0;
  const monthBounds = useMemo(() => getMonthInputBounds(), []);

  // Sort components so OVERDUE/DUE_NOW render at the top, then DUE_SOON,
  // then ALL_GOOD. Tie-break by componentId for stable ordering.
  const sortedComponents = useMemo(() => {
    return [...bike.components].sort((a, b) => {
      const aPri = STATUS_PRIORITY[a.status] ?? 99;
      const bPri = STATUS_PRIORITY[b.status] ?? 99;
      if (aPri !== bPri) return aPri - bPri;
      return a.componentId.localeCompare(b.componentId);
    });
  }, [bike.components]);

  // Count selected uncalibrated components
  const selectedCount = uncalibratedComponents.filter((c) => selectedIds.has(c.componentId)).length;
  const allSelected = selectedCount === uncalibratedComponents.length && uncalibratedComponents.length > 0;

  return (
    <div className={`calibration-bike ${allNeedsAttentionAddressed ? 'calibration-bike-done' : ''}`}>
      {/* Bike header */}
      <button
        type="button"
        className="calibration-bike-header"
        onClick={onToggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="calibration-bike-info">
          {bike.thumbnailUrl ? (
            <img src={bike.thumbnailUrl} alt="" className="calibration-bike-thumb" />
          ) : (
            <div className="calibration-bike-thumb-placeholder">
              <Bike size={20} />
            </div>
          )}
          <div className="calibration-bike-name">
            <span className="calibration-bike-title">{bike.bikeName}</span>
            <span className="calibration-bike-count">
              {allNeedsAttentionAddressed ? (
                <><Check size={12} className="icon-success" /> All set</>
              ) : (
                `${needsAttentionCount} need${needsAttentionCount === 1 ? 's' : ''} attention`
              )}
            </span>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* Expanded content */}
      {isExpanded && !allComponentsCalibrated && (
        <div className="calibration-bike-content">
          {/* Bulk action */}
          <div className="calibration-bulk-action">
            <label className="calibration-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
                disabled={isSubmitting}
              />
              <span>Mark serviced in:</span>
            </label>
            <input
              type="month"
              className="form-input form-input-sm"
              value={formatMonthValue(bulkDate?.month ?? new Date().getMonth(), bulkDate?.year ?? new Date().getFullYear())}
              onChange={(e) => {
                const { month, year } = parseMonthValue(e.target.value);
                onBulkDateChange(month, year);
              }}
              min={monthBounds.min}
              max={monthBounds.max}
              disabled={isSubmitting}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={onBulkService}
              disabled={isSubmitting || selectedCount === 0}
            >
              Log Service ({selectedCount})
            </Button>
          </div>

          {/* Component list */}
          <div className="calibration-components">
            {sortedComponents.map((component) => (
              <ComponentRow
                key={component.componentId}
                component={component}
                isCalibrated={calibratedIds.has(component.componentId)}
                isSelected={selectedIds.has(component.componentId)}
                onToggleSelection={() => onToggleSelection(component.componentId)}
                onSnoozeAlert={() => onSnoozeAlert(component.componentId)}
                onAcknowledge={() => onAcknowledge(component.componentId)}
                isInlineDateOpen={inlineDateComponentId === component.componentId}
                inlineDate={inlineDate}
                monthBounds={monthBounds}
                onOpenInlineLogService={() => onOpenInlineLogService(component.componentId)}
                onInlineDateChange={onInlineDateChange}
                onConfirmInlineLogService={() => onConfirmInlineLogService(component.componentId)}
                onCancelInlineLogService={onCancelInlineLogService}
                isSubmitting={isSubmitting}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ComponentRowProps {
  component: ComponentPrediction;
  isCalibrated: boolean;
  isSelected: boolean;
  onToggleSelection: () => void;
  onSnoozeAlert: () => void;
  onAcknowledge: () => void;
  isInlineDateOpen: boolean;
  inlineDate: { month: number; year: number } | null;
  monthBounds: { min: string; max: string };
  onOpenInlineLogService: () => void;
  onInlineDateChange: (date: { month: number; year: number } | null) => void;
  onConfirmInlineLogService: () => void;
  onCancelInlineLogService: () => void;
  isSubmitting: boolean;
}

function ComponentRow({
  component,
  isCalibrated,
  isSelected,
  onToggleSelection,
  onSnoozeAlert,
  onAcknowledge,
  isInlineDateOpen,
  inlineDate,
  monthBounds,
  onOpenInlineLogService,
  onInlineDateChange,
  onConfirmInlineLogService,
  onCancelInlineLogService,
  isSubmitting,
}: ComponentRowProps) {
  const label = formatComponentLabel(component);
  const makeModel = [component.brand, component.model].filter(Boolean).join(' ') || 'Stock';

  if (isCalibrated) {
    return (
      <div className="calibration-component calibration-component-done">
        <div className="calibration-component-check">
          <Check size={12} />
        </div>
        <div className="calibration-component-info">
          <span className="calibration-component-label">{label}</span>
          <span className="calibration-component-make">{makeModel}</span>
        </div>
        <span className="calibration-component-status">Calibrated</span>
      </div>
    );
  }

  // Inline Log Service flow: this row owns the inline date picker until
  // the user confirms or cancels. The row's normal action buttons are
  // swapped out for the picker + Save/Cancel so the user can't fire a
  // second action mid-edit.
  if (isInlineDateOpen) {
    const now = new Date();
    const monthValue = inlineDate
      ? formatMonthValue(inlineDate.month, inlineDate.year)
      : formatMonthValue(now.getMonth(), now.getFullYear());
    return (
      <div className="calibration-component">
        <StatusDot status={component.status as PredictionStatus} />
        <div className="calibration-component-info">
          <span className="calibration-component-label">{label}</span>
          <span className="calibration-component-make">{makeModel}</span>
        </div>
        <input
          type="month"
          className="form-input form-input-sm"
          value={monthValue}
          onChange={(e) => {
            const { month, year } = parseMonthValue(e.target.value);
            onInlineDateChange({ month, year });
          }}
          min={monthBounds.min}
          max={monthBounds.max}
          disabled={isSubmitting}
          aria-label={`Service date for ${label}`}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirmInlineLogService}
          disabled={isSubmitting || !inlineDate}
        >
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancelInlineLogService}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="calibration-component">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggleSelection}
        disabled={isSubmitting}
        className="calibration-component-checkbox"
        aria-label={`Select ${label}`}
      />
      <StatusDot status={component.status as PredictionStatus} />
      <div className="calibration-component-info">
        <span className="calibration-component-label">{label}</span>
        <span className="calibration-component-make">{makeModel}</span>
      </div>
      <span className="calibration-component-hours">
        {Math.round(component.hoursSinceService)}h since service
      </span>
      <Button
        variant="primary"
        size="sm"
        onClick={onOpenInlineLogService}
        disabled={isSubmitting}
        title="Record a date you serviced this component"
      >
        Log Service
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onAcknowledge}
        disabled={isSubmitting}
        title="Hours are accurate - no service has been performed"
      >
        Acknowledge
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onSnoozeAlert}
        disabled={isSubmitting}
        title="Visually inspected - extend service interval by 50%"
      >
        <BellOff size={10} className="icon-left" />
        Snooze
      </Button>
    </div>
  );
}
