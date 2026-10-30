import { useState } from 'react';
import { FileDown } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { todayDateInput } from '@/lib/format';
import { MAINTENANCE_EXPORT_URL, filenameFromDisposition } from '@/lib/maintenanceExport';

/**
 * Whole-account CSV of the rider's maintenance history, free for every tier:
 * a raw copy of what they typed is portability, not a product. Same blob
 * download mechanics as the per-bike PDF; the server fires the export event.
 */
export default function MaintenanceExportPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(MAINTENANCE_EXPORT_URL, { credentials: 'include' });
      if (res.status === 429) {
        throw new Error('You exported recently. Try again in a little while.');
      }
      if (!res.ok) {
        throw new Error('Could not build the export. Please try again.');
      }
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `loam-logger-maintenance-${todayDateInput()}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-spaced">
      <div>
        <p className="label-section">Your data</p>
        <h2 className="title-section">Maintenance history</h2>
      </div>
      <p className="text-sm text-muted">
        Every service, inspection, install and removal across all your bikes, with the parts
        fitted, what they cost and your notes, as a spreadsheet-ready CSV. It is your record;
        take it wherever you like.
      </p>
      <p className="text-xs text-muted">
        Hours at each event come from your synced rides. Where any of them came from Garmin,
        the file ends with two attribution rows in the first column, after the event rows.
      </p>
      <div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={busy}>
          <FileDown size={14} className="icon-left" />
          {busy ? 'Preparing…' : 'Export maintenance history (CSV)'}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
