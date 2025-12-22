// src/lib/format.ts
export function fmtDateTime(iso: number) {
  const d = new Date(iso);
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

export const fmtMiles = (mi: number) => `${mi.toFixed(1)} mi`;
export const fmtFeet = (ft: number) => `${Math.round(ft)} ft`;

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
