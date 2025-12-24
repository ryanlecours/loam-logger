import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  referrer: string | null;
  createdAt: string;
}

interface AdminStats {
  userCount: number;
  waitlistCount: number;
}

export default function Admin() {
  const { user, loading: userLoading } = useCurrentUser();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [exporting, setExporting] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!userLoading && isAdmin) {
      fetchStats();
      fetchWaitlist(1);
    }
  }, [userLoading, isAdmin]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/stats`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats({
        userCount: data.users,
        waitlistCount: data.waitlist,
      });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchWaitlist = async (pageNum: number) => {
    try {
      setLoading(true);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/waitlist?page=${pageNum}&limit=50`,
        { credentials: 'include' }
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
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

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
      alert('Failed to export waitlist');
    } finally {
      setExporting(false);
    }
  };

  // Show loading while checking user
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Redirect non-admins
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Admin Panel</p>
            <h1 className="text-3xl font-semibold text-white">Loam Logger Admin</h1>
            <p className="text-sm text-muted max-w-2xl">
              Manage waitlist signups and view platform statistics.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Overview */}
      {stats && (
        <section className="grid gap-6 md:grid-cols-2">
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Total Users</p>
            <p className="text-4xl font-bold text-white">{stats.userCount}</p>
          </div>
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Waitlist Signups</p>
            <p className="text-4xl font-bold text-white">{stats.waitlistCount}</p>
          </div>
        </section>
      )}

      {/* Waitlist Table */}
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Beta Waitlist</p>
            <h2 className="text-xl font-semibold text-white">Email Signups</h2>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 transition disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-950/30 border border-red-600/50 p-4">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app/50">
                <th className="text-left py-3 px-4 text-muted font-medium">Email</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Name</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Referrer</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Signed Up</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.map((entry) => (
                <tr key={entry.id} className="border-b border-app/30 hover:bg-surface-2/50">
                  <td className="py-3 px-4 text-white">{entry.email}</td>
                  <td className="py-3 px-4 text-muted">{entry.name || '-'}</td>
                  <td className="py-3 px-4 text-muted truncate max-w-[200px]">
                    {entry.referrer || '-'}
                  </td>
                  <td className="py-3 px-4 text-muted">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        )}

        {!loading && hasMore && (
          <div className="flex justify-center">
            <button
              onClick={() => fetchWaitlist(page + 1)}
              className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-surface-2 hover:bg-surface-2/80 border border-app transition"
            >
              Load More
            </button>
          </div>
        )}

        {!loading && waitlist.length === 0 && (
          <p className="text-center text-muted py-8">No waitlist entries yet.</p>
        )}
      </section>
    </div>
  );
}
