import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button';
import { getAuthHeaders } from '@/lib/csrf';
import { AdminTable } from '../components/AdminTable';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import {
  IndividualEmailModal,
  type IndividualEmailTarget,
} from '../components/IndividualEmailModal';

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  referrer: string | null;
  createdAt: string;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
}

interface ImportResults {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; email: string; reason: string }>;
}

const PAGE_SIZE = 50;

const COLUMNS = [
  { key: 'select', label: <span className="sr-only">Select</span>, width: '2.5rem' },
  { key: 'email', label: 'Email' },
  { key: 'name', label: 'Name' },
  { key: 'founding', label: 'Founding Rider' },
  { key: 'signed', label: 'Signed Up' },
  { key: 'actions', label: 'Action', align: 'right' as const },
];

// Parse CSV line handling quoted fields. Same logic as the old Admin.tsx —
// kept here so a single import-row helper isn't pulled into a separate util
// file just for the admin page.
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function WaitlistSection() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);

  const [activating, setActivating] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [bulkPromoting, setBulkPromoting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailTarget, setEmailTarget] = useState<IndividualEmailTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WaitlistEntry | null>(null);

  const fetchWaitlist = async (pageNum: number) => {
    try {
      setLoading(true);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/waitlist?page=${pageNum}&limit=${PAGE_SIZE}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to fetch waitlist');
      const data = await res.json();
      if (pageNum === 1) {
        setWaitlist(data.entries);
      } else {
        setWaitlist((prev) => [...prev, ...data.entries]);
      }
      setHasMore(data.pagination.page < data.pagination.totalPages);
      setPage(data.pagination.page);
    } catch (err) {
      console.error('Failed to fetch waitlist:', err);
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWaitlist(1);
  }, []);

  const handleExport = async () => {
    try {
      setExporting(true);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/waitlist/export`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to export');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waitlist-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Failed to export waitlist');
    } finally {
      setExporting(false);
    }
  };

  const handleImportCSV = async (file: File) => {
    try {
      setImporting(true);
      setImportResults(null);

      const content = await file.text();
      const lines = content.split(/\r?\n/);
      if (lines.length < 2) {
        toast.error('CSV file is empty or has no data rows');
        return;
      }

      const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
      const emailIdx = header.findIndex((h) => h.includes('email'));
      const nameIdx = header.findIndex((h) => h.includes('name'));
      const signedUpIdx = header.findIndex(
        (h) => h.includes('signed up') || h.includes('signedup'),
      );

      if (emailIdx === -1) {
        toast.error('CSV must have an "Email" column');
        return;
      }

      const users: Array<{ email: string; name?: string; signedUp?: string }> = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCSVLine(line);
        const email = fields[emailIdx]?.trim();
        if (!email) continue;
        users.push({
          email,
          name: nameIdx >= 0 ? fields[nameIdx]?.trim() || undefined : undefined,
          signedUp: signedUpIdx >= 0 ? fields[signedUpIdx]?.trim() || undefined : undefined,
        });
      }

      if (users.length === 0) {
        toast.error('No valid users found in CSV');
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/waitlist/import`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ users }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');

      setImportResults(data);
      if (data.imported > 0) {
        fetchWaitlist(1);
      }

      let message = `Import complete: ${data.imported} imported`;
      if (data.skipped > 0) message += `, ${data.skipped} skipped (duplicates)`;
      if (data.errors.length > 0) message += `, ${data.errors.length} failed`;
      toast.success(message);
    } catch (err) {
      console.error('Import failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to import waitlist');
    } finally {
      setImporting(false);
    }
  };

  const handleActivate = async (entry: WaitlistEntry) => {
    if (
      !confirm(
        `Activate ${entry.email}? They will receive an email with a temporary password.`,
      )
    ) {
      return;
    }

    try {
      setActivating(entry.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/activate/${entry.id}`,
        { method: 'POST', credentials: 'include', headers: getAuthHeaders() },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to activate');
      }
      setWaitlist((prev) => prev.filter((e) => e.id !== entry.id));
      toast.success(
        `${entry.email} activated! They will receive an email with login instructions.`,
      );
    } catch (err) {
      console.error('Activation failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to activate user');
    } finally {
      setActivating(null);
    }
  };

  const handleToggleFoundingRider = async (entry: WaitlistEntry) => {
    const newStatus = !entry.isFoundingRider;
    try {
      setPromoting(entry.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users/${entry.id}/founding-rider`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ isFoundingRider: newStatus }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update founding rider status');
      }
      setWaitlist((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, isFoundingRider: newStatus } : e,
        ),
      );
    } catch (err) {
      console.error('Toggle founding rider failed:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to update founding rider status',
      );
    } finally {
      setPromoting(null);
    }
  };

  const handleBulkToggleFoundingRider = async (setAsFoundingRider: boolean) => {
    const count = selected.size;
    if (count === 0) return;
    const action = setAsFoundingRider
      ? 'mark as Founding Riders'
      : 'remove Founding Rider status from';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${count} user(s)?`)) {
      return;
    }

    try {
      setBulkPromoting(true);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users/founding-rider/bulk`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            userIds: Array.from(selected),
            isFoundingRider: setAsFoundingRider,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update founding rider status');
      }
      const data = await res.json();
      setWaitlist((prev) =>
        prev.map((e) =>
          selected.has(e.id) ? { ...e, isFoundingRider: setAsFoundingRider } : e,
        ),
      );
      setSelected(new Set());
      toast.success(
        `${data.updatedCount} user(s) ${
          setAsFoundingRider ? 'marked as' : 'removed from'
        } Founding Riders.`,
      );
    } catch (err) {
      console.error('Bulk toggle founding rider failed:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to update founding rider status',
      );
    } finally {
      setBulkPromoting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(deleteTarget.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/waitlist/${deleteTarget.id}`,
        { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete waitlist entry');
      }
      setWaitlist((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success(`${deleteTarget.email} removed from waitlist.`);
    } catch (err) {
      console.error('Delete waitlist entry failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete waitlist entry');
    } finally {
      setDeleting(null);
    }
  };

  const toggleSelection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <section className="panel-spaced">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Beta Waitlist</p>
            <h1 className="text-3xl font-semibold text-white">Waitlist</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => handleBulkToggleFoundingRider(true)}
                  disabled={bulkPromoting}
                  className="btn-success disabled:opacity-50"
                >
                  {bulkPromoting
                    ? 'Updating…'
                    : `Mark ${selected.size} as Founding Riders`}
                </button>
                <Button
                  variant="outline"
                  onClick={() => handleBulkToggleFoundingRider(false)}
                  disabled={bulkPromoting}
                >
                  Remove Founding Rider
                </Button>
              </>
            )}
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImportCSV(file);
                  // Reset so re-importing the same file fires onChange.
                  e.target.value = '';
                }
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="btn-success disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import CSV'}
            </button>
          </div>
        </div>

        {/* Import results summary */}
        {importResults && (
          <div className="rounded-2xl bg-surface-2/50 border border-app/50 p-4">
            <p className="text-white font-medium mb-2">Import Results</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-success">{importResults.imported} imported</span>
              {importResults.skipped > 0 && (
                <span className="text-warning">
                  {importResults.skipped} skipped (duplicates)
                </span>
              )}
              {importResults.errors.length > 0 && (
                <span className="text-danger">
                  {importResults.errors.length} failed
                </span>
              )}
            </div>
            {importResults.errors.length > 0 && (
              <details className="mt-2">
                <summary className="text-muted text-sm cursor-pointer hover:text-white">
                  View errors
                </summary>
                <ul className="mt-2 text-xs text-danger/80 space-y-1">
                  {importResults.errors.slice(0, 10).map((err, idx) => (
                    <li key={idx}>
                      Row {err.row}: {err.email || '(no email)'} — {err.reason}
                    </li>
                  ))}
                  {importResults.errors.length > 10 && (
                    <li className="text-muted">
                      …and {importResults.errors.length - 10} more
                    </li>
                  )}
                </ul>
              </details>
            )}
            <button
              type="button"
              onClick={() => setImportResults(null)}
              className="mt-2 text-xs text-muted hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Bulk selection controls */}
        {waitlist.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">
              {selected.size} of {waitlist.length} selected
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set(waitlist.map((w) => w.id)))}
              className="text-primary hover:underline"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-muted hover:underline"
            >
              Deselect All
            </button>
          </div>
        )}

        <AdminTable
          columns={COLUMNS}
          rowCount={waitlist.length}
          loading={loading && waitlist.length === 0}
          empty="No waitlist entries yet."
          loadMore={
            hasMore && !loading ? (
              <Button
                variant="outline"
                onClick={() => fetchWaitlist(page + 1)}
                disabled={loading}
              >
                Load More
              </Button>
            ) : null
          }
        >
          {waitlist.map((entry) => (
            <tr
              key={entry.id}
              className="border-b border-app/30 hover:bg-surface-2/50"
            >
              <td className="py-3 px-4">
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={() => toggleSelection(entry.id)}
                  aria-label={`Select ${entry.email}`}
                  className="rounded border-app"
                />
              </td>
              <td className="py-3 px-4 text-white">
                {entry.email}
                {entry.emailUnsubscribed && (
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-danger/30 text-danger">
                    Unsubscribed
                  </span>
                )}
              </td>
              <td className="py-3 px-4 text-muted">{entry.name || '—'}</td>
              <td className="py-3 px-4">
                <button
                  type="button"
                  onClick={() => handleToggleFoundingRider(entry)}
                  disabled={promoting === entry.id}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    entry.isFoundingRider
                      ? 'bg-success text-success-foreground hover:bg-success/80'
                      : 'bg-surface-2 text-muted border border-app hover:text-white/90'
                  } disabled:opacity-50`}
                  aria-pressed={entry.isFoundingRider}
                >
                  {promoting === entry.id ? '…' : entry.isFoundingRider ? 'Yes' : 'No'}
                </button>
              </td>
              <td className="py-3 px-4 text-muted">
                {new Date(entry.createdAt).toLocaleDateString()}
              </td>
              <td className="py-3 px-4 text-right">
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setEmailTarget({
                        id: entry.id,
                        email: entry.email,
                        name: entry.name,
                      })
                    }
                    disabled={entry.emailUnsubscribed}
                    className="btn-sm rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-info hover:bg-info/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    title={entry.emailUnsubscribed ? 'User has unsubscribed' : 'Send email'}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => handleActivate(entry)}
                    disabled={
                      activating === entry.id ||
                      deleting === entry.id ||
                      promoting === entry.id
                    }
                    className="btn-success btn-sm"
                  >
                    {activating === entry.id ? 'Activating…' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(entry)}
                    disabled={
                      deleting === entry.id ||
                      activating === entry.id ||
                      promoting === entry.id
                    }
                    className="btn-danger btn-sm"
                  >
                    {deleting === entry.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </AdminTable>
      </section>

      <IndividualEmailModal target={emailTarget} onClose={() => setEmailTarget(null)} />

      <ConfirmDeleteModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Remove from waitlist"
        message={
          deleteTarget && (
            <>
              Remove <strong className="text-white">{deleteTarget.email}</strong> from the waitlist? This action cannot be undone.
            </>
          )
        }
        confirmLabel="Remove"
        loading={deleting !== null}
      />
    </>
  );
}
