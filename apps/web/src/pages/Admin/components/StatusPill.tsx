type ScheduledEmailStatus = 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed';

const TONE_BY_STATUS: Record<ScheduledEmailStatus, string> = {
  pending: 'bg-warning text-warning-foreground',
  processing: 'bg-info text-info-foreground',
  sent: 'bg-success text-success-foreground',
  cancelled: 'bg-surface-2 text-muted',
  failed: 'bg-danger text-danger-foreground',
};

/**
 * Status pill for a scheduled email. Centralizes the status-to-color
 * mapping that the old Admin.tsx inlined as a 4-deep ternary — easier to
 * extend (e.g. adding a `paused` state) and easier to read at the call site.
 */
export function StatusPill({ status }: { status: ScheduledEmailStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TONE_BY_STATUS[status]}`}
    >
      {status}
    </span>
  );
}
