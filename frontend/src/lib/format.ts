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
