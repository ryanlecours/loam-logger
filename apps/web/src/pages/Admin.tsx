import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { getAuthHeaders } from '@/lib/csrf';

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  referrer: string | null;
  createdAt: string;
}

interface UserEntry {
  id: string;
  email: string;
  name: string | null;
  role: 'FREE' | 'PRO' | 'ADMIN';
  createdAt: string;
  activatedAt: string | null;
}

interface AdminStats {
  userCount: number;
  waitlistCount: number;
}

interface AddUserForm {
  email: string;
  name: string;
  role: 'FREE' | 'PRO' | 'ADMIN';
  sendActivationEmail: boolean;
}

export default function Admin() {
  const { user, loading: userLoading } = useCurrentUser();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [usersHasMore, setUsersHasMore] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [demoting, setDemoting] = useState<string | null>(null);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [addUserForm, setAddUserForm] = useState<AddUserForm>({
    email: '',
    name: '',
    role: 'FREE',
    sendActivationEmail: true,
  });

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!userLoading && isAdmin) {
      fetchStats();
      fetchWaitlist(1);
      fetchUsers(1);
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

  const fetchUsers = async (pageNum: number) => {
    try {
      setUsersLoading(true);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users?page=${pageNum}&limit=50`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();

      if (pageNum === 1) {
        setUsers(data.users);
      } else {
        setUsers((prev) => [...prev, ...data.users]);
      }
      setUsersHasMore(data.pagination.page < data.pagination.totalPages);
      setUsersPage(data.pagination.page);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setUsersLoading(false);
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

  const handleActivate = async (userId: string, email: string) => {
    if (!confirm(`Activate ${email}? They will receive an email with a temporary password.`)) {
      return;
    }

    try {
      setActivating(userId);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/activate/${userId}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to activate');
      }

      // Remove from waitlist and refresh stats
      setWaitlist((prev) => prev.filter((entry) => entry.id !== userId));
      fetchStats();
      alert(`${email} has been activated! They will receive an email with login instructions.`);
    } catch (err) {
      console.error('Activation failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to activate user');
    } finally {
      setActivating(null);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserForm.email.trim()) {
      alert('Email is required');
      return;
    }

    try {
      setAddingUser(true);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(addUserForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      // Reset form and close modal
      setAddUserForm({ email: '', name: '', role: 'FREE', sendActivationEmail: true });
      setShowAddUserForm(false);

      // Refresh users and stats
      fetchUsers(1);
      fetchStats();

      if (data.emailQueued) {
        alert(`User ${data.user.email} created! Activation email sent.`);
      } else if (data.tempPassword) {
        alert(`User created! Email failed to send.\n\nTemp password: ${data.tempPassword}`);
      } else {
        alert(`User ${data.user.email} created successfully!`);
      }
    } catch (err) {
      console.error('Add user failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Delete user ${email}? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(userId);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      // Remove from local state and refresh stats
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      fetchStats();
    } catch (err) {
      console.error('Delete user failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(null);
    }
  };

  const handleDemoteUser = async (userId: string, email: string) => {
    if (!confirm(`Demote ${email} to waitlist? They will need to be re-activated to access the app.`)) {
      return;
    }

    try {
      setDemoting(userId);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users/${userId}/demote`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to demote user');
      }

      // Remove from users list and refresh both lists
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      fetchWaitlist(1);
      fetchStats();
    } catch (err) {
      console.error('Demote user failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to demote user');
    } finally {
      setDemoting(null);
    }
  };

  const handleDeleteWaitlist = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from waitlist? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(userId);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/waitlist/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete waitlist entry');
      }

      // Remove from local state and refresh stats
      setWaitlist((prev) => prev.filter((w) => w.id !== userId));
      fetchStats();
    } catch (err) {
      console.error('Delete waitlist entry failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete waitlist entry');
    } finally {
      setDeleting(null);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-purple-600 text-purple-100';
      case 'PRO':
        return 'bg-amber-600 text-amber-100';
      default:
        return 'bg-blue-600 text-blue-100';
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

      {/* Active Users Table */}
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Active Users</p>
            <h2 className="text-xl font-semibold text-white">User Management</h2>
          </div>
          <button
            onClick={() => setShowAddUserForm(true)}
            className="rounded-2xl px-4 py-2 text-sm font-medium text-black bg-green-500 hover:bg-green-400 transition"
          >
            + Add User
          </button>
        </div>

        {/* Add User Modal */}
        {showAddUserForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-semibold text-white mb-4">Add New User</h3>
              <form onSubmit={handleAddUser} className="space-y-4">
                <div>
                  <label className="block text-sm text-muted mb-1">Email *</label>
                  <input
                    type="email"
                    value={addUserForm.email}
                    onChange={(e) => setAddUserForm({ ...addUserForm, email: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="user@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={addUserForm.name}
                    onChange={(e) => setAddUserForm({ ...addUserForm, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted mb-1">Role</label>
                  <select
                    value={addUserForm.role}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, role: e.target.value as 'FREE' | 'PRO' | 'ADMIN' })
                    }
                    className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="FREE">Free</option>
                    <option value="PRO">Pro</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="sendActivationEmail"
                    checked={addUserForm.sendActivationEmail}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, sendActivationEmail: e.target.checked })
                    }
                    className="rounded border-app"
                  />
                  <label htmlFor="sendActivationEmail" className="text-sm text-muted">
                    Send activation email with temporary password
                  </label>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddUserForm(false)}
                    className="flex-1 rounded-2xl px-4 py-2 text-sm font-medium text-white bg-surface-2 hover:bg-surface-2/80 border border-app transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addingUser}
                    className="flex-1 rounded-2xl px-4 py-2 text-sm font-medium text-black bg-green-500 hover:bg-green-400 transition disabled:opacity-50"
                  >
                    {addingUser ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app/50">
                <th className="text-left py-3 px-4 text-muted font-medium">Email</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Name</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Role</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Activated</th>
                <th className="text-right py-3 px-4 text-muted font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-app/30 hover:bg-surface-2/50">
                  <td className="py-3 px-4 text-white">{u.email}</td>
                  <td className="py-3 px-4 text-muted">{u.name || '-'}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(u.role)}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted">
                    {u.activatedAt ? new Date(u.activatedAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleDemoteUser(u.id, u.email)}
                        disabled={demoting === u.id || deleting === u.id || u.id === user?.id}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-yellow-600 hover:bg-yellow-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={u.id === user?.id ? "Can't demote yourself" : 'Demote to waitlist'}
                      >
                        {demoting === u.id ? 'Demoting...' : 'Demote'}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id, u.email)}
                        disabled={deleting === u.id || demoting === u.id || u.id === user?.id}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={u.id === user?.id ? "Can't delete yourself" : 'Delete user'}
                      >
                        {deleting === u.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {usersLoading && (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        )}

        {!usersLoading && usersHasMore && (
          <div className="flex justify-center">
            <button
              onClick={() => fetchUsers(usersPage + 1)}
              className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-surface-2 hover:bg-surface-2/80 border border-app transition"
            >
              Load More
            </button>
          </div>
        )}

        {!usersLoading && users.length === 0 && (
          <p className="text-center text-muted py-8">No active users yet.</p>
        )}
      </section>

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
                <th className="text-left py-3 px-4 text-muted font-medium">Signed Up</th>
                <th className="text-right py-3 px-4 text-muted font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.map((entry) => (
                <tr key={entry.id} className="border-b border-app/30 hover:bg-surface-2/50">
                  <td className="py-3 px-4 text-white">{entry.email}</td>
                  <td className="py-3 px-4 text-muted">{entry.name || '-'}</td>
                  <td className="py-3 px-4 text-muted">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleActivate(entry.id, entry.email)}
                        disabled={activating === entry.id || deleting === entry.id}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {activating === entry.id ? 'Activating...' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteWaitlist(entry.id, entry.email)}
                        disabled={deleting === entry.id || activating === entry.id}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deleting === entry.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
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
