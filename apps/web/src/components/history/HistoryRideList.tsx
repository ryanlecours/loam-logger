import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { fmtDistance, fmtDuration, fmtElevationPair } from '@/lib/format';

export type HistoryRide = {
  key: string;
  /** The ride's date, already formatted: the owner's page and the share page
   *  start from different values (an instant, and a bare calendar day). */
  dateLabel: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  /** Null or absent when no source reported a descent; the row then shows climb alone. */
  elevationLossMeters?: number | null;
  trailSystem?: string | null;
  location?: string | null;
  /** Extra context for the date line, such as the bike it was ridden on. */
  note?: string | null;
  /**
   * Source attribution. Rendered in the title row because the Garmin API Brand
   * Guidelines treat it as title-level: never a tooltip or a footnote.
   */
  badges?: ReactNode;
};

/**
 * The rides behind a component history's totals, one row each, newest first.
 * Shared by the owner's page and the public share page, which pass their own
 * attribution badges and paging.
 */
export function HistoryRideList({
  rides,
  distanceUnit,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  rides: HistoryRide[];
  distanceUnit: 'mi' | 'km';
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore: () => void;
}) {
  return (
    <>
      <ul className="mt-2 space-y-1">
        {rides.map((r) => {
          // The same title the rides list and dashboard use.
          const title = r.trailSystem || r.location || 'Ride';
          const where = r.trailSystem && r.location ? r.location : null;
          return (
            <li
              key={r.key}
              className="flex items-center gap-3 py-2 border-b border-border last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium truncate">{title}</span>
                  {r.badges}
                </div>
                <div className="text-xs text-muted truncate">
                  {[r.dateLabel, where, r.note].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{fmtDuration(r.durationSeconds)}</div>
                <div className="text-xs text-muted">
                  {fmtDistance(r.distanceMeters, distanceUnit)} ·{' '}
                  {fmtElevationPair(r.elevationGainMeters, r.elevationLossMeters, distanceUnit)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more rides'}
        </Button>
      )}
    </>
  );
}
