// src/lib/format.ts
export function fmtDateTime(iso: string | number | Date) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const fmtDistance = (meters: number, unit: 'mi' | 'km' = 'mi') => {
  if (unit === 'km') {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${(meters / 1609.344).toFixed(1)} mi`;
};
export const fmtElevation = (meters: number, unit: 'mi' | 'km' = 'mi') =>
  unit === 'km'
    ? `${Math.round(meters).toLocaleString()} m`
    : `${Math.round(meters * 3.28084).toLocaleString()} ft`;

/** Accepts ISO string / epoch string / number / Date and returns yyyy-MM-ddTHH:mm (local) */
export function toLocalInputValue(v: string | number | Date): string {
  const ms =
    v instanceof Date ? v.getTime() : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return new Date().toISOString().slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** Converts a datetime-local string back to ISO (Z) */
export function fromLocalInputValue(s: string): string {
  return new Date(s).toISOString();
}

/**
 * Convert a `<input type="date">` value (yyyy-mm-dd, timezone-less) to an
 * ISO string anchored at local noon. `new Date('2021-08-15')` parses as
 * UTC midnight, which in UTC-5 would shift to 2021-08-14 on the server —
 * the "my date was saved a day early" bug. Anchoring at local noon keeps
 * the calendar day stable across reasonable timezones.
 */
export function dateInputToIsoNoon(dateValue: string): string {
  return new Date(`${dateValue}T12:00:00`).toISOString();
}

/**
 * Convert an ISO timestamp back to a `<input type="date">` value
 * (yyyy-mm-dd in the user's local timezone). Returns '' for null,
 * undefined, or unparseable input so callers can feed it directly into an
 * `<input value={...}>` without extra null-checks.
 */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
