import { useState, useCallback, useEffect } from 'react';
import { useMutation } from '@apollo/client';
import { FaCheck, FaWrench, FaExclamationTriangle } from 'react-icons/fa';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LOG_COMPONENT_SERVICE } from '../../graphql/logComponentService';
import { BIKES } from '../../graphql/bikes';
import { formatComponentLabel, getBikeName } from '../../utils/formatters';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import { StatusDot } from './StatusDot';

interface LogServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: BikeWithPredictions | null;
  defaultComponentId?: string | null;
}

export function LogServiceModal({
  isOpen,
  onClose,
  bike,
  defaultComponentId,
}: LogServiceModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [serviceDate, setServiceDate] = useState(() =>
    new Date().toISOString().split('T')[0]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logService] = useMutation(LOG_COMPONENT_SERVICE, {
    refetchQueries: [{ query: BIKES }],
  });

  // Sync selection and reset date when modal opens
  useEffect(() => {
    if (isOpen) {
      if (defaultComponentId) {
        setSelectedIds(new Set([defaultComponentId]));
      } else {
        setSelectedIds(new Set());
      }
      setServiceDate(new Date().toISOString().split('T')[0]);
      setError(null);
    }
  }, [isOpen, defaultComponentId]);

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

  const handleSubmit = useCallback(async () => {
    if (selectedIds.size === 0) return;

    setIsSubmitting(true);
    setError(null);
    try {
      // Log service for each selected component with the selected date
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          logService({ variables: { id, performedAt: serviceDate } })
        )
      );
      onClose();
    } catch (err) {
      console.error('Failed to log service:', err);
      setError('Failed to log service. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, serviceDate, logService, onClose]);

  const handleClose = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  if (!bike) return null;

  const components = bike.predictions?.components ?? [];
  const bikeName = getBikeName(bike);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Log Service"
      size="md"
    >
      <div className="log-service-modal-content">
        <div className="log-service-modal-bike">
          <FaWrench size={16} style={{ color: 'var(--sage)' }} />
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
            max={new Date().toISOString().split('T')[0]}
            className="log-service-date-input"
          />
        </div>

        <div>
          <p style={{ margin: '0 0 0.75rem', color: 'var(--sage)', fontSize: '0.875rem' }}>
            Select components that were serviced:
          </p>

          <div className="log-service-checklist">
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
                    {isSelected && <FaCheck size={10} style={{ color: 'var(--forest-deep)' }} />}
                  </div>
                  <StatusDot status={component.status} />
                  <span className="log-service-item-label">
                    {formatComponentLabel(component)}
                  </span>
                  <span className="log-service-item-hours">
                    {component.hoursRemaining.toFixed(1)} hrs
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '0.5rem',
            color: '#ef4444',
            fontSize: '0.875rem',
          }}>
            <FaExclamationTriangle size={14} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={selectedIds.size === 0 || isSubmitting}
          >
            {isSubmitting ? 'Logging...' : `Log Service (${selectedIds.size})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
