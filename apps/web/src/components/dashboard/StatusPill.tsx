import { CircleAlert, TriangleAlert, Clock, CircleCheck, Bike } from 'lucide-react';
import type { PredictionStatus } from '../../types/prediction';
import { STATUS_CONFIG } from '../../types/prediction';

interface StatusPillProps {
  status: PredictionStatus | null;
  className?: string;
}

const STATUS_ICONS: Record<PredictionStatus, React.ComponentType<{ className?: string }>> = {
  OVERDUE: CircleAlert,
  DUE_NOW: TriangleAlert,
  DUE_SOON: Clock,
  ALL_GOOD: CircleCheck,
};

const STATUS_CLASSES: Record<PredictionStatus, string> = {
  OVERDUE: 'status-pill-overdue',
  DUE_NOW: 'status-pill-due-now',
  DUE_SOON: 'status-pill-due-soon',
  ALL_GOOD: 'status-pill-all-good',
};

export function StatusPill({ status, className = '' }: StatusPillProps) {
  // Predictive status is Pro-only; render nothing when the API serves null.
  if (!status) return null;

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

/**
 * The badge a bike wears before any ride has reached it. Health comes from
 * hours ridden, so a bike with none has no health state yet: "All good" there
 * is unearned, and would tell a rider whose import has not landed that their
 * bike has been checked. This is deliberately outside the four-state ramp,
 * in muted sage, so it never reads as a fifth level of severity.
 */
export function NoRidesPill({ className = '' }: { className?: string }) {
  return (
    <span className={`status-pill status-pill-no-rides ${className}`.trim()}>
      <Bike className="status-pill-icon" />
      No rides yet
    </span>
  );
}
