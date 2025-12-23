import { useState, useEffect } from 'react';
import { useMutation } from '@apollo/client';
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaExclamationTriangle,
} from 'react-icons/fa';
import { LOG_COMPONENT_SERVICE } from '../graphql/logComponentService';
import { BIKES } from '../graphql/bikes';
import { Modal, Button } from './ui';
import type { BikeHealth, ComponentHealth } from '../utils/transformToHealthData';

interface BikeHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: BikeHealth | null;
}

const statusIcons = {
  ok: <FaCheckCircle className="component-icon icon-good" />,
  warning: <FaExclamationTriangle className="component-icon icon-warning" />,
  danger: <FaExclamationCircle className="component-icon icon-danger" />,
};

function formatHoursAndMinutes(totalHours: number): string {
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);

  if (minutes === 60) {
    return `${hours + 1}h 0m`;
  }
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function formatLastService(date: Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return date.toLocaleDateString();
}

function getStatusClass(status: 'ok' | 'warning' | 'danger'): string {
  switch (status) {
    case 'ok':
      return 'component-status-good';
    case 'warning':
      return 'component-status-warning';
    case 'danger':
      return 'component-status-danger';
  }
}

export function BikeHealthModal({ isOpen, onClose, bike }: BikeHealthModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLogging, setIsLogging] = useState(false);
  const [logService] = useMutation(LOG_COMPONENT_SERVICE, {
    refetchQueries: [{ query: BIKES }],
  });

  // Pre-select all components when modal opens
  useEffect(() => {
    if (isOpen && bike) {
      setSelectedIds(bike.components.map((c) => c.id));
    }
  }, [isOpen, bike]);

  const toggleSelection = (componentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(componentId)
        ? prev.filter((id) => id !== componentId)
        : [...prev, componentId]
    );
  };

  const handleLogService = async () => {
    if (selectedIds.length === 0) {
      alert('Select at least one component to log.');
      return;
    }

    setIsLogging(true);
    try {
      await Promise.all(
        selectedIds.map((id) =>
          logService({
            variables: { id },
          })
        )
      );
      onClose();
    } catch (err) {
      console.error('Failed to log service:', err);
      alert('Failed to log service. Please try again.');
    } finally {
      setIsLogging(false);
    }
  };

  if (!bike) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={bike.name}
      subtitle="Component health and service status"
      size="lg"
      preventClose={isLogging}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLogging}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleLogService}
            disabled={isLogging || selectedIds.length === 0}
          >
            {isLogging ? 'Logging...' : `Log Service (${selectedIds.length})`}
          </Button>
        </>
      }
    >
      <div className="component-details-list">
        {bike.components.map((component: ComponentHealth) => (
          <label
            key={component.id}
            className={`component-detail-row ${getStatusClass(component.status)}`}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(component.id)}
              onChange={() => toggleSelection(component.id)}
              className="component-checkbox"
            />
            <div className="component-detail-content">
              <div className="component-detail-header">
                <div className="component-detail-info">
                  <span className="component-label">{component.label}</span>
                  <span className="component-brand">
                    {component.brand} {component.model}
                  </span>
                </div>
                {statusIcons[component.status]}
              </div>

              <div className="component-detail-stats">
                <div className="stat-item">
                  <span className="stat-label">Current Hours</span>
                  <span className="stat-value">
                    {formatHoursAndMinutes(component.hoursUsed)}
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Last Service</span>
                  <span className="stat-value">
                    {formatLastService(component.lastServiceDate)}
                  </span>
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}
