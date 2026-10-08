// Helpers for component share links: turning date-input values into the
// window the API stores, and describing a window in words.

export type ComponentShareScope = 'LIFETIME' | 'SINCE_SERVICE' | 'RANGE';

export interface ShareWindow {
  scope: ComponentShareScope;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}

/** Local midnight at the start of a `yyyy-mm-dd` day, as ISO. */
export function localDayStartIso(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00`).toISOString();
}

/**
 * Local midnight at the start of the day AFTER a `yyyy-mm-dd` day, as ISO. The
 * API stores a range as [start, end), so this makes the chosen end day count.
 */
export function localDayAfterIso(dateInput: string): string {
  const d = new Date(`${dateInput}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}

/** "Jan 1, 2026 – Jan 31, 2026" for a stored [start, end) range. */
export function rangeLabel(startIso: string, endIso: string): string {
  // The end is exclusive, so the last day shown is the one before it.
  const lastDay = new Date(new Date(endIso).getTime() - 1);
  return `${fmtDay(startIso)} – ${fmtDay(lastDay.toISOString())}`;
}

/** A short name for what a link shows, for lists and headings. */
export function shareScopeLabel(share: ShareWindow): string {
  switch (share.scope) {
    case 'LIFETIME':
      return 'Lifetime';
    case 'SINCE_SERVICE':
      return 'Since last service';
    case 'RANGE':
      return share.rangeStart && share.rangeEnd ? rangeLabel(share.rangeStart, share.rangeEnd) : 'Date range';
  }
}
