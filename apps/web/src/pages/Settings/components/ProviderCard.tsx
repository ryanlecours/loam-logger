import type { ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';

export type ProviderCardProps = {
  icon: ReactNode;
  displayName: string;
  brandColorVar: string;
  connectedAt: string;
  onSyncPrevious: () => void;
  onDisconnect: () => void;
  syncLabel?: string;
  disconnectLabel?: string;
  showAdminClear?: boolean;
  onClearRides?: () => void;
  clearRidesLoading?: boolean;
  clearRidesLabel?: string;
};

export default function ProviderCard({
  icon,
  displayName,
  brandColorVar,
  connectedAt,
  onSyncPrevious,
  onDisconnect,
  syncLabel = 'Sync Previous Rides',
  disconnectLabel = 'Disconnect',
  showAdminClear = false,
  onClearRides,
  clearRidesLoading = false,
  clearRidesLabel,
}: ProviderCardProps) {
  const brand = `var(${brandColorVar})`;

  return (
    <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-lg" style={{ color: brand }}>
            {icon}
          </span>
          <div>
            <p className="font-semibold">{displayName}</p>
            <p className="text-xs text-muted">
              Connected {formatDistanceToNow(new Date(connectedAt))} ago
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSyncPrevious}
            className="rounded-xl px-3 py-1.5 text-xs font-medium transition hover:cursor-pointer"
            style={{
              color: brand,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: `color-mix(in srgb, ${brand} 30%, transparent)`,
              backgroundColor: 'rgba(32, 32, 38, 0.5)',
            }}
          >
            {syncLabel}
          </button>
          {showAdminClear && onClearRides && (
            <button
              type="button"
              onClick={onClearRides}
              disabled={clearRidesLoading}
              className="rounded-xl border border-orange-200/40 bg-transparent px-3 py-1.5 text-xs font-medium text-orange-200/90 transition hover:bg-orange-500/10 hover:border-orange-200/70 hover:text-orange-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clearRidesLoading ? 'Deleting…' : clearRidesLabel ?? `Clear ${displayName} Rides`}
            </button>
          )}
          <button
            type="button"
            onClick={onDisconnect}
            className="rounded-xl border border-red-400/30 bg-surface-2/50 px-3 py-1.5 text-xs font-medium text-red-400/80 transition hover:bg-surface-2 hover:text-red-400 hover:border-red-400/50 hover:cursor-pointer"
          >
            {disconnectLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
