// Where the whole-account maintenance CSV lives and how its filename comes
// back. Beside the Settings panel that downloads it.

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const MAINTENANCE_EXPORT_URL = `${API_BASE}/api/export/maintenance.csv`;

/** The filename the server chose, from its Content-Disposition header. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}
