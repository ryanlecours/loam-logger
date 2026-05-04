import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { Button } from '../../../components/ui/Button';
import { getAuthHeaders } from '@/lib/csrf';
import { AdminTable } from '../components/AdminTable';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { RoleBadge } from '../components/RoleBadge';
import {
  IndividualEmailModal,
  type IndividualEmailTarget,
} from '../components/IndividualEmailModal';
import { AddUserModal } from './components/AddUserModal';

interface UserEntry {
  id: string;
  email: string;
  name: string | null;
  role: 'FREE' | 'PRO' | 'ADMIN';
  createdAt: string;
  activatedAt: string | null;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
  lastPasswordResetEmailAt: string | null;
}

const PAGE_SIZE = 50;

const COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'activated', label: 'Activated' },
  { key: 'actions', label: 'Action', align: 'right' as const },
];

/**
 * Active users table + per-row actions (email, password reset, demote,
 * delete). Destructive actions go through `<ConfirmDeleteModal>` requiring
 * a typed-email confirmation; the old Admin.tsx used `window.confirm()`
 * which gave no chance to verify the target. Self-deletes / self-demotes
 * are still blocked at the row level.
 */
export function UsersSection() {
  const { user: currentUser } = useCurrentUser();

  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [showAddUser, setShowAddUser] = useState(false);
  const [resettingPassword, setResettingPassword] = useState<string | null>(null);
  const [demoting, setDemoting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [emailTarget, setEmailTarget] = useState<IndividualEmailTarget | null>(null);

  // Per-action confirmation state. We model these as separate small pieces
  // rather than a single `confirmModal: { kind, target }` so each modal can
  // own its own copy without runtime narrowing at every render.
  const [demoteTarget, setDemoteTarget] = useState<UserEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserEntry | null>(null);

  const fetchUsers = async (pageNum: number) => {
    try {
      setLoading(true);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users?page=${pageNum}&limit=${PAGE_SIZE}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      if (pageNum === 1) {
        setUsers(data.users);
      } else {
        setUsers((prev) => [...prev, ...data.users]);
      }
      setHasMore(data.pagination.page < data.pagination.totalPages);
      setPage(data.pagination.page);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(1);
  }, []);

  const handleSendPasswordReset = async (target: UserEntry) => {
    const lastSent = target.lastPasswordResetEmailAt;
    const prompt = lastSent
      ? `A reset link was already sent to ${target.email} ${formatDistanceToNow(new Date(lastSent))} ago. Send another?`
      : `Email a password reset link to ${target.email}?`;
    if (!confirm(prompt)) return;

    try {
      setResettingPassword(target.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users/${target.id}/send-password-reset`,
        { method: 'POST', credentials: 'include', headers: getAuthHeaders() },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send password reset email');
      }

      // Optimistic local update so the row reflects "just now" without a refetch.
      const now = new Date().toISOString();
      setUsers((prev) =>
        prev.map((u) =>
          u.id === target.id ? { ...u, lastPasswordResetEmailAt: now } : u,
        ),
      );
      toast.success(`Password reset link sent to ${target.email}.`);
    } catch (err) {
      console.error('Send password reset failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send password reset email');
    } finally {
      setResettingPassword(null);
    }
  };

  const handleConfirmDemote = async () => {
    if (!demoteTarget) return;
    try {
      setDemoting(demoteTarget.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users/${demoteTarget.id}/demote`,
        { method: 'POST', credentials: 'include', headers: getAuthHeaders() },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to demote user');
      }
      setUsers((prev) => prev.filter((u) => u.id !== demoteTarget.id));
      setDemoteTarget(null);
      toast.success(`${demoteTarget.email} demoted to waitlist.`);
    } catch (err) {
      console.error('Demote user failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to demote user');
    } finally {
      setDemoting(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(deleteTarget.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/users/${deleteTarget.id}`,
        { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete user');
      }
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success(`${deleteTarget.email} deleted.`);
    } catch (err) {
      console.error('Delete user failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <section className="panel-spaced">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Active Users</p>
            <h1 className="text-3xl font-semibold text-white">Users</h1>
          </div>
          <button
            type="button"
            onClick={() => setShowAddUser(true)}
            className="btn-success"
          >
            + Add User
          </button>
        </div>

        <AdminTable
          columns={COLUMNS}
          rowCount={users.length}
          loading={loading && users.length === 0}
          empty="No active users yet."
          loadMore={
            hasMore && !loading ? (
              <Button
                variant="outline"
                onClick={() => fetchUsers(page + 1)}
                disabled={loading}
              >
                Load More
              </Button>
            ) : null
          }
        >
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            return (
              <tr key={u.id} className="border-b border-app/30 hover:bg-surface-2/50">
                <td className="py-3 px-4 text-white">
                  {u.email}
                  {u.emailUnsubscribed && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-danger/30 text-danger">
                      Unsubscribed
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-muted">{u.name || '—'}</td>
                <td className="py-3 px-4">
                  <RoleBadge role={u.role} />
                  {u.isFoundingRider && (
                    <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-success text-success-foreground">
                      Founding Rider
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-muted">
                  {u.activatedAt ? new Date(u.activatedAt).toLocaleDateString() : '—'}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setEmailTarget({ id: u.id, email: u.email, name: u.name })
                      }
                      disabled={u.emailUnsubscribed}
                      className="btn-sm rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-info hover:bg-info/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title={u.emailUnsubscribed ? 'User has unsubscribed' : 'Send email'}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendPasswordReset(u)}
                      disabled={
                        resettingPassword === u.id ||
                        deleting === u.id ||
                        demoting === u.id
                      }
                      className="btn-sm rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        u.lastPasswordResetEmailAt
                          ? `Last reset sent ${formatDistanceToNow(new Date(u.lastPasswordResetEmailAt))} ago`
                          : 'Email a password reset link'
                      }
                    >
                      {resettingPassword === u.id ? 'Sending…' : 'Reset Pwd'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDemoteTarget(u)}
                      disabled={demoting === u.id || deleting === u.id || isSelf}
                      className="btn-warning btn-sm"
                      title={isSelf ? "Can't demote yourself" : 'Demote to waitlist'}
                    >
                      {demoting === u.id ? 'Demoting…' : 'Demote'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(u)}
                      disabled={deleting === u.id || demoting === u.id || isSelf}
                      className="btn-danger btn-sm"
                      title={isSelf ? "Can't delete yourself" : 'Delete user'}
                    >
                      {deleting === u.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </AdminTable>
      </section>

      <AddUserModal
        isOpen={showAddUser}
        onClose={() => setShowAddUser(false)}
        onCreated={() => fetchUsers(1)}
      />

      <IndividualEmailModal target={emailTarget} onClose={() => setEmailTarget(null)} />

      <ConfirmDeleteModal
        isOpen={demoteTarget !== null}
        onClose={() => setDemoteTarget(null)}
        onConfirm={handleConfirmDemote}
        title="Demote to waitlist"
        message={
          demoteTarget && (
            <>
              Demote <strong className="text-white">{demoteTarget.email}</strong> to the waitlist? They&rsquo;ll need to be re-activated to access the app.
            </>
          )
        }
        confirmLabel="Demote"
        tone="warning"
        loading={demoting !== null}
      />

      <ConfirmDeleteModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete user"
        message={
          deleteTarget && (
            <>
              Permanently delete{' '}
              <strong className="text-white">{deleteTarget.email}</strong>? This action cannot be undone.
            </>
          )
        }
        // Typed-email confirm forces the admin to look at the target before
        // clicking — protects against a misclicked row in the table.
        confirmText={deleteTarget?.email}
        confirmLabel="Delete user"
        loading={deleting !== null}
      />
    </>
  );
}
