import { useState, useCallback } from 'react';
import { useMutation } from '@apollo/client';
import { FaCheck, FaWrench } from 'react-icons/fa';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LOG_COMPONENT_SERVICE } from '../../graphql/logComponentService';
import { BIKES } from '../../graphql/bikes';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { ComponentPrediction } from '../../types/prediction';
import { StatusDot } from './StatusDot';

interface LogServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: BikeWithPredictions | null;
  defaultComponentId?: string | null;
}

const COMPONENT_LABELS: Record<string, string> = {
  FORK: 'Fork',
  SHOCK: 'Shock',
  BRAKES: 'Brakes',
  DRIVETRAIN: 'Drivetrain',
  TIRES: 'Tires',
  CHAIN: 'Chain',
  CASSETTE: 'Cassette',
  CHAINRING: 'Chainring',
  WHEELS: 'Wheels',
  DROPPER: 'Dropper',
  PIVOT_BEARINGS: 'Pivot Bearings',
  BRAKE_PAD: 'Brake Pads',
  BRAKE_ROTOR: 'Brake Rotor',
  HEADSET: 'Headset',
  BOTTOM_BRACKET: 'Bottom Bracket',
};

const LOCATION_LABELS: Record<string, string> = {
  FRONT: 'Front',
  REAR: 'Rear',
  NONE: '',
};

function formatComponentLabel(component: ComponentPrediction): string {
  const baseLabel = COMPONENT_LABELS[component.componentType] ?? component.componentType;
  const locationLabel = LOCATION_LABELS[component.location] ?? '';

  if (locationLabel && component.location !== 'NONE') {
    return `${baseLabel} (${locationLabel})`;
  }
  return baseLabel;
}

function getBikeName(bike: BikeWithPredictions): string {
  return bike.nickname?.trim() || `${bike.manufacturer} ${bike.model}`.trim() || 'Bike';
}

export function LogServiceModal({
  isOpen,
  onClose,
  bike,
  defaultComponentId,
}: LogServiceModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (defaultComponentId) {
      return new Set([defaultComponentId]);
    }
    return new Set();
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [logService] = useMutation(LOG_COMPONENT_SERVICE, {
    refetchQueries: [{ query: BIKES }],
  });

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
    try {
      // Log service for each selected component
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          logService({ variables: { id } })
        )
      );
      onClose();
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to log service:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, logService, onClose]);

  const handleClose = useCallback(() => {
    setSelectedIds(new Set());
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
