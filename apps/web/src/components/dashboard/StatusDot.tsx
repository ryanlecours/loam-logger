import type { PredictionStatus } from '../../types/prediction';

interface StatusDotProps {
  status: PredictionStatus;
  className?: string;
}

const STATUS_CLASSES: Record<PredictionStatus, string> = {
  OVERDUE: 'status-dot-overdue',
  DUE_NOW: 'status-dot-due-now',
  DUE_SOON: 'status-dot-due-soon',
  ALL_GOOD: 'status-dot-all-good',
};

export function StatusDot({ status, className = '' }: StatusDotProps) {
  const statusClass = STATUS_CLASSES[status];

  return <span className={`status-dot ${statusClass} ${className}`.trim()} />;
}
