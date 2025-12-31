import { FaExclamationCircle, FaExclamationTriangle, FaClock, FaCheckCircle } from 'react-icons/fa';
import type { PredictionStatus } from '../../types/prediction';
import { STATUS_CONFIG } from '../../types/prediction';

interface StatusPillProps {
  status: PredictionStatus;
  className?: string;
}

const STATUS_ICONS: Record<PredictionStatus, React.ComponentType<{ className?: string }>> = {
  OVERDUE: FaExclamationCircle,
  DUE_NOW: FaExclamationTriangle,
  DUE_SOON: FaClock,
  ALL_GOOD: FaCheckCircle,
};

const STATUS_CLASSES: Record<PredictionStatus, string> = {
  OVERDUE: 'status-pill-overdue',
  DUE_NOW: 'status-pill-due-now',
  DUE_SOON: 'status-pill-due-soon',
  ALL_GOOD: 'status-pill-all-good',
};

export function StatusPill({ status, className = '' }: StatusPillProps) {
  const Icon = STATUS_ICONS[status];
  const config = STATUS_CONFIG[status];
  const statusClass = STATUS_CLASSES[status];

  return (
    <span className={`status-pill ${statusClass} ${className}`.trim()}>
      <Icon className="status-pill-icon" />
      {config.label}
    </span>
  );
}
