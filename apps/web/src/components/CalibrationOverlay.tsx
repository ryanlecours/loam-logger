import { useState, useCallback, useEffect, useMemo } from 'react';
import { FaWrench, FaBicycle, FaCheck, FaChevronDown, FaChevronUp, FaExclamationTriangle, FaCheckCircle } from 'react-icons/fa';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { StatusDot } from './dashboard/StatusDot';
import {
  useCalibrationState,
  useLogBulkService,
  useDismissCalibration,
  useCompleteCalibration,
  type BikeCalibrationInfo,
} from '../graphql/calibration';
import { formatComponentLabel } from '../utils/formatters';
import type { ComponentPrediction, PredictionStatus } from '../types/prediction';

interface CalibrationOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

// Month names for the date picker
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Generate year options (current year back to 10 years ago)
function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - 10; y--) {
    years.push(y);
  }
  return years;
}

export function CalibrationOverlay({ isOpen, onClose }: CalibrationOverlayProps) {
  const { data, refetch } = useCalibrationState();
  const [logBulkService] = useLogBulkService();
  const [dismissCalibration] = useDismissCalibration();
  const [completeCalibration] = useCompleteCalibration();

  // Track which components have been calibrated (by componentId)
  const [calibratedIds, setCalibratedIds] = useState<Set<string>>(new Set());
  // Track expanded bike sections
  const [expandedBikes, setExpandedBikes] = useState<Set<string>>(new Set());
  // Track bulk action date per bike
  const [bulkDates, setBulkDates] = useState<Record<string, { month: number; year: number }>>({});
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const calibrationState = data?.calibrationState;
  const bikes = useMemo(() => calibrationState?.bikes ?? [], [calibrationState?.bikes]);

  // Calculate progress
  const totalNeedingCalibration = useMemo(() => {
    return bikes.reduce((sum, bike) => sum + bike.components.length, 0);
  }, [bikes]);

  const calibratedCount = calibratedIds.size;
  const remainingCount = totalNeedingCalibration - calibratedCount;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCalibratedIds(new Set());
      setError(null);
      setSuccessMessage(null);
      // Expand first bike by default
      if (bikes.length > 0) {
        setExpandedBikes(new Set([bikes[0].bikeId]));
      }
      // Initialize bulk dates to current month/year
      const now = new Date();
      const initialDates: Record<string, { month: number; year: number }> = {};
      bikes.forEach((bike) => {
        initialDates[bike.bikeId] = { month: now.getMonth(), year: now.getFullYear() };
      });
      setBulkDates(initialDates);
    }
  }, [isOpen, bikes]);

  const toggleBikeExpanded = useCallback((bikeId: string) => {
    setExpandedBikes((prev) => {
      const next = new Set(prev);
      if (next.has(bikeId)) {
        next.delete(bikeId);
      } else {
        next.add(bikeId);
      }
      return next;
    });
  }, []);

  const handleBulkServiceDate = useCallback(async (bikeId: string) => {
    const bike = bikes.find((b) => b.bikeId === bikeId);
    if (!bike) return;

    const dateInfo = bulkDates[bikeId];
    if (!dateInfo) return;

    // Get uncalibrated components for this bike
    const uncalibratedComponents = bike.components.filter((c) => !calibratedIds.has(c.componentId));
    if (uncalibratedComponents.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Create ISO date string (1st of the selected month)
      const performedAt = new Date(dateInfo.year, dateInfo.month, 1).toISOString();
      const componentIds = uncalibratedComponents.map((c) => c.componentId);

      await logBulkService({
        variables: {
          input: { componentIds, performedAt },
        },
      });

      // Mark these components as calibrated
      setCalibratedIds((prev) => {
        const next = new Set(prev);
        componentIds.forEach((id) => next.add(id));
        return next;
      });

      setSuccessMessage(`Logged service for ${componentIds.length} components`);
      setTimeout(() => setSuccessMessage(null), 3000);

      // Refetch to update state
      refetch();
    } catch (err) {
      setError('Failed to log service. Please try again.');
      console.error('Bulk service error:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [bikes, bulkDates, calibratedIds, logBulkService, refetch]);

  const handleJustInspected = useCallback(async (componentId: string) => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Log service as today
      const performedAt = new Date().toISOString();

      await logBulkService({
        variables: {
          input: { componentIds: [componentId], performedAt },
        },
      });

      // Mark as calibrated
      setCalibratedIds((prev) => new Set([...prev, componentId]));

      setSuccessMessage('Component marked as inspected');
      setTimeout(() => setSuccessMessage(null), 3000);

      refetch();
    } catch (err) {
      setError('Failed to log service. Please try again.');
      console.error('Inspection error:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [logBulkService, refetch]);

  const handleDismiss = useCallback(async () => {
    try {
      await dismissCalibration();
    } catch (err) {
      console.warn('Failed to dismiss calibration:', err);
    }
    onClose();
  }, [dismissCalibration, onClose]);

  const handleComplete = useCallback(async () => {
    try {
      await completeCalibration();
    } catch (err) {
      console.warn('Failed to complete calibration:', err);
    }
    onClose();
  }, [completeCalibration, onClose]);

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
              style={{ width: `${totalNeedingCalibration > 0 ? (calibratedCount / totalNeedingCalibration) * 100 : 0}%` }}
            />
          </div>
          <span className="calibration-progress-text">
            {calibratedCount} of {totalNeedingCalibration} calibrated
          </span>
        </div>

        {/* Info message */}
        <div className="calibration-info">
          <p>
            We imported your ride history, but we need to know when components were last serviced
            to give accurate maintenance predictions.
          </p>
        </div>

        {/* Bike sections */}
        <div className="calibration-bikes">
          {bikes.map((bike) => (
            <BikeSection
              key={bike.bikeId}
              bike={bike}
              isExpanded={expandedBikes.has(bike.bikeId)}
              onToggleExpanded={() => toggleBikeExpanded(bike.bikeId)}
              calibratedIds={calibratedIds}
              bulkDate={bulkDates[bike.bikeId]}
              onBulkDateChange={(month, year) => {
                setBulkDates((prev) => ({
                  ...prev,
                  [bike.bikeId]: { month, year },
                }));
              }}
              onBulkService={() => handleBulkServiceDate(bike.bikeId)}
              onJustInspected={handleJustInspected}
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
            {remainingCount === 0 ? 'Done' : 'Finish Anyway'}
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
  bulkDate: { month: number; year: number } | undefined;
  onBulkDateChange: (month: number, year: number) => void;
  onBulkService: () => void;
  onJustInspected: (componentId: string) => void;
  isSubmitting: boolean;
}

function BikeSection({
  bike,
  isExpanded,
  onToggleExpanded,
  calibratedIds,
  bulkDate,
  onBulkDateChange,
  onBulkService,
  onJustInspected,
  isSubmitting,
}: BikeSectionProps) {
  const uncalibratedCount = bike.components.filter((c) => !calibratedIds.has(c.componentId)).length;
  const allCalibrated = uncalibratedCount === 0;
  const years = useMemo(() => getYearOptions(), []);

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
            <span className="calibration-bulk-label">
              All serviced in:
            </span>
            <select
              className="form-select form-select-sm"
              value={bulkDate?.month ?? new Date().getMonth()}
              onChange={(e) => onBulkDateChange(parseInt(e.target.value), bulkDate?.year ?? new Date().getFullYear())}
              disabled={isSubmitting}
            >
              {MONTHS.map((month, idx) => (
                <option key={month} value={idx}>{month}</option>
              ))}
            </select>
            <select
              className="form-select form-select-sm"
              value={bulkDate?.year ?? new Date().getFullYear()}
              onChange={(e) => onBulkDateChange(bulkDate?.month ?? new Date().getMonth(), parseInt(e.target.value))}
              disabled={isSubmitting}
            >
              {years.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              onClick={onBulkService}
              disabled={isSubmitting || uncalibratedCount === 0}
            >
              Apply to All ({uncalibratedCount})
            </Button>
          </div>

          {/* Component list */}
          <div className="calibration-components">
            {bike.components.map((component) => (
              <ComponentRow
                key={component.componentId}
                component={component}
                isCalibrated={calibratedIds.has(component.componentId)}
                onJustInspected={() => onJustInspected(component.componentId)}
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
  onJustInspected: () => void;
  isSubmitting: boolean;
}

function ComponentRow({ component, isCalibrated, onJustInspected, isSubmitting }: ComponentRowProps) {
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
        onClick={onJustInspected}
        disabled={isSubmitting}
        title="Mark as just inspected and in good condition"
      >
        <FaWrench size={10} className="icon-left" />
        Good
      </Button>
    </div>
  );
}
