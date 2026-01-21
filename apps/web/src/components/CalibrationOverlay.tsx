import { useState, useCallback, useEffect, useMemo } from 'react';
import { FaBellSlash, FaBicycle, FaCheck, FaChevronDown, FaChevronUp, FaExclamationTriangle, FaCheckCircle } from 'react-icons/fa';
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
  // Track initial total for progress (captured when modal opens, doesn't change on refetch)
  const [initialTotal, setInitialTotal] = useState(0);
  // Track pending service logs to batch submit on completion (componentId -> performedAt)
  const [pendingServiceLogs, setPendingServiceLogs] = useState<Map<string, string>>(new Map());
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const calibrationState = data?.calibrationState;
  const bikes = useMemo(() => calibrationState?.bikes ?? [], [calibrationState?.bikes]);

  // Calculate progress using initial total (stable across refetches)
  const calibratedCount = calibratedIds.size;
  const remainingCount = initialTotal - calibratedCount;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCalibratedIds(new Set());
      setPendingServiceLogs(new Map());
      setError(null);
      setSuccessMessage(null);
      // Capture initial total for progress tracking (stable across refetches)
      const total = bikes.reduce((sum, bike) => sum + bike.components.length, 0);
      setInitialTotal(total);
      // Expand first bike by default
      if (bikes.length > 0) {
        setExpandedBikeId(bikes[0].bikeId);
      }
      // Initialize bulk dates to current month/year
      const now = new Date();
      const initialDates: Record<string, { month: number; year: number }> = {};
      const initialSelected: Record<string, Set<string>> = {};
      bikes.forEach((bike) => {
        initialDates[bike.bikeId] = { month: now.getMonth(), year: now.getFullYear() };
        // Select all uncalibrated components by default
        initialSelected[bike.bikeId] = new Set(bike.components.map((c) => c.componentId));
      });
      setBulkDates(initialDates);
      setSelectedComponents(initialSelected);
    }
  }, [isOpen, bikes]);

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
        {/* Progress bar */}
        <div className="calibration-progress">
          <div className="calibration-progress-bar">
            <div
              className="calibration-progress-fill"
              style={{ width: `${initialTotal > 0 ? (calibratedCount / initialTotal) * 100 : 0}%` }}
            />
          </div>
          <span className="calibration-progress-text">
            {calibratedCount} of {initialTotal} calibrated
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
              onBulkDateChange={(month, year) => {
                setBulkDates((prev) => ({
                  ...prev,
                  [bike.bikeId]: { month, year },
                }));
              }}
              onBulkService={() => handleBulkServiceDate(bike.bikeId)}
              onSnoozeAlert={handleSnooze}
              onAcknowledge={handleAcknowledge}
              isSubmitting={isSubmitting}
            />
          ))}
        </div>

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
  isSubmitting,
}: BikeSectionProps) {
  const uncalibratedComponents = bike.components.filter((c) => !calibratedIds.has(c.componentId));
  const uncalibratedCount = uncalibratedComponents.length;
  const allCalibrated = uncalibratedCount === 0;
  const monthBounds = useMemo(() => getMonthInputBounds(), []);

  // Count selected uncalibrated components
  const selectedCount = uncalibratedComponents.filter((c) => selectedIds.has(c.componentId)).length;
  const allSelected = selectedCount === uncalibratedCount && uncalibratedCount > 0;

  return (
    <div className={`calibration-bike ${allCalibrated ? 'calibration-bike-done' : ''}`}>
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
              <FaBicycle size={20} />
            </div>
          )}
          <div className="calibration-bike-name">
            <span className="calibration-bike-title">{bike.bikeName}</span>
            <span className="calibration-bike-count">
              {allCalibrated ? (
                <><FaCheck size={12} className="icon-success" /> All set</>
              ) : (
                `${uncalibratedCount} need${uncalibratedCount === 1 ? 's' : ''} attention`
              )}
            </span>
          </div>
        </div>
        {isExpanded ? <FaChevronUp size={14} /> : <FaChevronDown size={14} />}
      </button>

      {/* Expanded content */}
      {isExpanded && !allCalibrated && (
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
              <span>Serviced in:</span>
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
              Apply to {selectedCount === uncalibratedCount ? 'All' : 'Selected'} ({selectedCount})
            </Button>
          </div>

          {/* Component list */}
          <div className="calibration-components">
            {bike.components.map((component) => (
              <ComponentRow
                key={component.componentId}
                component={component}
                isCalibrated={calibratedIds.has(component.componentId)}
                isSelected={selectedIds.has(component.componentId)}
                onToggleSelection={() => onToggleSelection(component.componentId)}
                onSnoozeAlert={() => onSnoozeAlert(component.componentId)}
                onAcknowledge={() => onAcknowledge(component.componentId)}
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
  isSubmitting: boolean;
}

function ComponentRow({ component, isCalibrated, isSelected, onToggleSelection, onSnoozeAlert, onAcknowledge, isSubmitting }: ComponentRowProps) {
  const label = formatComponentLabel(component);
  const makeModel = [component.brand, component.model].filter(Boolean).join(' ') || 'Stock';

  if (isCalibrated) {
    return (
      <div className="calibration-component calibration-component-done">
        <div className="calibration-component-check">
          <FaCheck size={12} />
        </div>
        <div className="calibration-component-info">
          <span className="calibration-component-label">{label}</span>
          <span className="calibration-component-make">{makeModel}</span>
        </div>
        <span className="calibration-component-status">Calibrated</span>
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
        <FaBellSlash size={10} className="icon-left" />
        Snooze
      </Button>
    </div>
  );
}
