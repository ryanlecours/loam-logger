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
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
}

interface UserEntry {
  id: string;
  email: string;
  name: string | null;
  role: 'FREE' | 'PRO' | 'ADMIN';
  createdAt: string;
  activatedAt: string | null;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
}

interface AdminStats {
  userCount: number;
  waitlistCount: number;
  foundingRidersCount: number;
}

interface AddUserForm {
  email: string;
  name: string;
  role: 'FREE' | 'PRO' | 'ADMIN';
  sendActivationEmail: boolean;
}

interface EmailRecipient {
  id: string;
  email: string;
  name: string | null;
  emailUnsubscribed: boolean;
  isFoundingRider: boolean;
}

type EmailSegment = 'WAITLIST' | 'WAITLIST_FOUNDING' | 'WAITLIST_REGULAR';

interface EmailForm {
  segment: EmailSegment;
  templateType: 'announcement' | 'custom';
  subject: string;
  messageHtml: string;
  scheduledFor: string | null;
}

interface EmailPreview {
  subject: string;
  html: string;
}

interface SendResult {
  sent: number;
  failed: number;
  suppressed: number;
  total: number;
}

interface ScheduledEmail {
  id: string;
  subject: string;
  scheduledFor: string;
  recipientCount: number;
  status: 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed';
  createdAt: string;
  sentCount?: number;
  failedCount?: number;
  suppressedCount?: number;
  processedAt?: string;
  errorMessage?: string;
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

  // Promote state
  const [promoting, setPromoting] = useState<string | null>(null);
  const [bulkPromoting, setBulkPromoting] = useState(false);
  const [selectedWaitlist, setSelectedWaitlist] = useState<Set<string>>(new Set());

  // Email compose state
  const [emailForm, setEmailForm] = useState<EmailForm>({
    segment: 'WAITLIST',
    templateType: 'announcement',
    subject: '',
    messageHtml: '',
    scheduledFor: null,
  });
  const [emailRecipients, setEmailRecipients] = useState<EmailRecipient[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [showConfirmSend, setShowConfirmSend] = useState(false);

  // Scheduled emails state
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);
  const [cancellingScheduled, setCancellingScheduled] = useState<string | null>(null);

  // Individual email modal state
  const [individualEmailTarget, setIndividualEmailTarget] = useState<{
    id: string;
    email: string;
    name: string | null;
  } | null>(null);
  const [individualEmailForm, setIndividualEmailForm] = useState({
    subject: '',
    messageHtml: '',
    templateType: 'announcement' as 'announcement' | 'custom',
  });
  const [sendingIndividualEmail, setSendingIndividualEmail] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!userLoading && isAdmin) {
      fetchStats();
      fetchWaitlist(1);
      fetchUsers(1);
      fetchScheduledEmails();
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
        foundingRidersCount: data.foundingRiders || 0,
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

  // Toggle founding rider status
  const handleToggleFoundingRider = async (userId: string, email: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const action = newStatus ? 'mark as Founding Rider' : 'remove Founding Rider status from';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${email}?`)) {
      return;
    }

    try {
      setPromoting(userId);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users/${userId}/founding-rider`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isFoundingRider: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update founding rider status');
      }

      // Update local state
      setWaitlist((prev) =>
        prev.map((entry) =>
          entry.id === userId ? { ...entry, isFoundingRider: newStatus } : entry
        )
      );
      fetchStats();
      alert(`${email} ${newStatus ? 'marked as' : 'removed from'} Founding Rider!`);
    } catch (err) {
      console.error('Toggle founding rider failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to update founding rider status');
    } finally {
      setPromoting(null);
    }
  };

  const handleBulkToggleFoundingRider = async (setAsFoundingRider: boolean) => {
    const count = selectedWaitlist.size;
    if (count === 0) return;

    const action = setAsFoundingRider ? 'mark as Founding Riders' : 'remove Founding Rider status from';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${count} user(s)?`)) {
      return;
    }

    try {
      setBulkPromoting(true);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users/founding-rider/bulk`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ userIds: Array.from(selectedWaitlist), isFoundingRider: setAsFoundingRider }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update founding rider status');
      }

      const data = await res.json();

      // Update local state
      setWaitlist((prev) =>
        prev.map((entry) =>
          selectedWaitlist.has(entry.id) ? { ...entry, isFoundingRider: setAsFoundingRider } : entry
        )
      );
      setSelectedWaitlist(new Set());
      fetchStats();
      alert(`${data.updatedCount} user(s) ${setAsFoundingRider ? 'marked as' : 'removed from'} Founding Riders!`);
    } catch (err) {
      console.error('Bulk toggle founding rider failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to update founding rider status');
    } finally {
      setBulkPromoting(false);
    }
  };

  const toggleWaitlistSelection = (id: string) => {
    setSelectedWaitlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllWaitlist = () => {
    setSelectedWaitlist(new Set(waitlist.map((w) => w.id)));
  };

  const handleDeselectAllWaitlist = () => {
    setSelectedWaitlist(new Set());
  };

  // Scheduled email functions
  const fetchScheduledEmails = async () => {
    setLoadingScheduled(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/scheduled`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setScheduledEmails(data.scheduledEmails);
      }
    } catch (err) {
      console.error('Failed to fetch scheduled emails:', err);
    } finally {
      setLoadingScheduled(false);
    }
  };

  const handleCancelScheduled = async (id: string) => {
    if (!confirm('Cancel this scheduled email? This action cannot be undone.')) {
      return;
    }

    try {
      setCancellingScheduled(id);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/scheduled/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel scheduled email');
      }

      // Refresh the scheduled emails list
      fetchScheduledEmails();
    } catch (err) {
      console.error('Cancel scheduled email failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to cancel scheduled email');
    } finally {
      setCancellingScheduled(null);
    }
  };

  const getDefaultScheduleTime = () => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0, 0, 0);
    return now.toISOString().slice(0, 16);
  };

  const getMinDatetime = () => {
    return new Date().toISOString().slice(0, 16);
  };

  // Email compose functions - map segment to API params
  const getEmailApiParams = (segment: EmailSegment): string => {
    switch (segment) {
      case 'WAITLIST':
        return 'role=WAITLIST';
      case 'WAITLIST_FOUNDING':
        return 'role=WAITLIST&foundingRider=true';
      case 'WAITLIST_REGULAR':
        return 'role=WAITLIST&foundingRider=false';
    }
  };

  const fetchEmailRecipients = async (segment: EmailSegment) => {
    setLoadingRecipients(true);
    try {
      const params = getEmailApiParams(segment);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/recipients?${params}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setEmailRecipients(data.users);
        // Pre-select all non-unsubscribed users
        const eligibleIds = data.users
          .filter((u: EmailRecipient) => !u.emailUnsubscribed)
          .map((u: EmailRecipient) => u.id);
        setSelectedRecipients(new Set(eligibleIds));
      }
    } catch (err) {
      console.error('Failed to fetch recipients:', err);
    } finally {
      setLoadingRecipients(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchEmailRecipients(emailForm.segment);
    }
  }, [isAdmin, emailForm.segment]);

  const handleSelectAll = () => {
    const eligibleIds = emailRecipients
      .filter((u) => !u.emailUnsubscribed)
      .map((u) => u.id);
    setSelectedRecipients(new Set(eligibleIds));
  };

  const handleDeselectAll = () => {
    setSelectedRecipients(new Set());
  };

  const toggleRecipient = (id: string) => {
    const newSet = new Set(selectedRecipients);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRecipients(newSet);
  };

  const handlePreviewEmail = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          templateType: emailForm.templateType,
          subject: emailForm.subject,
          messageHtml: emailForm.messageHtml,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEmailPreview(data);
        setShowEmailPreview(true);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to generate preview');
      }
    } catch (err) {
      alert('Failed to generate preview');
      console.error('Email preview failed:', err);
    }
  };

  const handleSendEmail = async () => {
    if (!showConfirmSend) {
      setShowConfirmSend(true);
      return;
    }

    setSendingEmail(true);
    setShowConfirmSend(false);
    setSendResult(null);

    const isScheduled = !!emailForm.scheduledFor;
    const endpoint = isScheduled
      ? `${import.meta.env.VITE_API_URL}/api/admin/email/schedule`
      : `${import.meta.env.VITE_API_URL}/api/admin/email/send`;

    try {
      const body: Record<string, unknown> = {
        userIds: Array.from(selectedRecipients),
        templateType: emailForm.templateType,
        subject: emailForm.subject,
        messageHtml: emailForm.messageHtml,
      };

      if (isScheduled) {
        body.scheduledFor = new Date(emailForm.scheduledFor!).toISOString();
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        if (isScheduled) {
          alert(`Email scheduled for ${new Date(emailForm.scheduledFor!).toLocaleString()}`);
          setEmailForm({ ...emailForm, subject: '', messageHtml: '', scheduledFor: null });
          fetchScheduledEmails();
        } else {
          setSendResult({ ...data.results, total: data.total });
          setEmailForm({ ...emailForm, subject: '', messageHtml: '' });
        }
      } else {
        alert(data.error || `Failed to ${isScheduled ? 'schedule' : 'send'} emails`);
      }
    } catch (err) {
      alert(`Failed to ${isScheduled ? 'schedule' : 'send'} emails`);
      console.error('Send email failed:', err);
    } finally {
      setSendingEmail(false);
    }
  };

  // Individual email functions
  const openIndividualEmailModal = (user: { id: string; email: string; name: string | null }) => {
    setIndividualEmailTarget(user);
    setIndividualEmailForm({
      subject: '',
      messageHtml: '',
      templateType: 'announcement',
    });
  };

  const closeIndividualEmailModal = () => {
    setIndividualEmailTarget(null);
  };

  const handleSendIndividualEmail = async () => {
    if (!individualEmailTarget) return;

    setSendingIndividualEmail(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/send`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userIds: [individualEmailTarget.id],
          templateType: individualEmailForm.templateType,
          subject: individualEmailForm.subject,
          messageHtml: individualEmailForm.messageHtml,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Email sent to ${individualEmailTarget.email}!`);
        closeIndividualEmailModal();
      } else {
        alert(data.error || 'Failed to send email');
      }
    } catch (err) {
      alert('Failed to send email');
      console.error('Individual email failed:', err);
    } finally {
      setSendingIndividualEmail(false);
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
        <section className="grid gap-6 md:grid-cols-3">
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Total Users</p>
            <p className="text-4xl font-bold text-white">{stats.userCount}</p>
          </div>
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Founding Riders</p>
            <p className="text-4xl font-bold text-white">{stats.foundingRidersCount}</p>
          </div>
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Waitlist Signups</p>
            <p className="text-4xl font-bold text-white">{stats.waitlistCount}</p>
          </div>
        </section>
      )}

      {/* Email Compose Section */}
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Bulk Email</p>
          <h2 className="text-xl font-semibold text-white">Send Email</h2>
        </div>

        {/* Segment Selector */}
        <div className="space-y-2">
          <label className="block text-sm text-muted">Recipients</label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emailSegment"
                value="WAITLIST"
                checked={emailForm.segment === 'WAITLIST'}
                onChange={() => setEmailForm({ ...emailForm, segment: 'WAITLIST' })}
                className="text-primary"
              />
              <span className="text-white">Waitlist - All</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emailSegment"
                value="WAITLIST_FOUNDING"
                checked={emailForm.segment === 'WAITLIST_FOUNDING'}
                onChange={() => setEmailForm({ ...emailForm, segment: 'WAITLIST_FOUNDING' })}
                className="text-primary"
              />
              <span className="text-white">Waitlist - Founding Riders</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emailSegment"
                value="WAITLIST_REGULAR"
                checked={emailForm.segment === 'WAITLIST_REGULAR'}
                onChange={() => setEmailForm({ ...emailForm, segment: 'WAITLIST_REGULAR' })}
                className="text-primary"
              />
              <span className="text-white">Waitlist - Non-Founding</span>
            </label>
          </div>
        </div>

        {/* Recipient List with Checkboxes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              {loadingRecipients
                ? 'Loading...'
                : `${selectedRecipients.size} of ${emailRecipients.filter((r) => !r.emailUnsubscribed).length} selected`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs text-primary hover:underline"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-xs text-muted hover:underline"
              >
                Deselect All
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-xl bg-surface-2 border border-app p-2 space-y-1">
            {emailRecipients.map((recipient) => (
              <label
                key={recipient.id}
                className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-surface-1 ${
                  recipient.emailUnsubscribed ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedRecipients.has(recipient.id)}
                  onChange={() => toggleRecipient(recipient.id)}
                  disabled={recipient.emailUnsubscribed}
                  className="rounded border-app"
                />
                <span className="text-white text-sm">{recipient.email}</span>
                {recipient.name && (
                  <span className="text-muted text-sm">({recipient.name})</span>
                )}
                {recipient.emailUnsubscribed && (
                  <span className="text-xs text-red-400 ml-auto">unsubscribed</span>
                )}
              </label>
            ))}
            {emailRecipients.length === 0 && !loadingRecipients && (
              <p className="text-center text-muted py-4">No recipients in this segment</p>
            )}
          </div>
        </div>

        {/* Template Selector */}
        <div>
          <label className="block text-sm text-muted mb-1">Template</label>
          <select
            value={emailForm.templateType}
            onChange={(e) =>
              setEmailForm({
                ...emailForm,
                templateType: e.target.value as 'announcement' | 'custom',
              })
            }
            className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="announcement">Announcement</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm text-muted mb-1">Subject</label>
          <input
            type="text"
            value={emailForm.subject}
            onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
            className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Email subject..."
          />
        </div>

        {/* Message Body */}
        <div>
          <label className="block text-sm text-muted mb-1">
            Message Body (plain text, newlines preserved)
          </label>
          <textarea
            value={emailForm.messageHtml}
            onChange={(e) => setEmailForm({ ...emailForm, messageHtml: e.target.value })}
            rows={8}
            className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary resize-y"
            placeholder="Your message here..."
          />
        </div>

        {/* Schedule Option */}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!emailForm.scheduledFor}
              onChange={(e) =>
                setEmailForm({
                  ...emailForm,
                  scheduledFor: e.target.checked ? getDefaultScheduleTime() : null,
                })
              }
              className="rounded border-app"
            />
            <span className="text-white">Schedule for later</span>
          </label>
          {emailForm.scheduledFor && (
            <input
              type="datetime-local"
              value={emailForm.scheduledFor}
              onChange={(e) => setEmailForm({ ...emailForm, scheduledFor: e.target.value })}
              min={getMinDatetime()}
              className="px-3 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handlePreviewEmail}
            disabled={!emailForm.subject || !emailForm.messageHtml}
            className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-surface-2 hover:bg-surface-2/80 border border-app transition disabled:opacity-50"
          >
            Preview
          </button>
          <button
            onClick={handleSendEmail}
            disabled={
              !emailForm.subject ||
              !emailForm.messageHtml ||
              sendingEmail ||
              selectedRecipients.size === 0
            }
            className="rounded-2xl px-4 py-2 text-sm font-medium text-black bg-primary hover:bg-primary/90 transition disabled:opacity-50"
          >
            {sendingEmail
              ? emailForm.scheduledFor
                ? 'Scheduling...'
                : 'Sending...'
              : showConfirmSend
                ? `Confirm ${emailForm.scheduledFor ? 'Schedule' : 'Send'} to ${selectedRecipients.size} recipients`
                : emailForm.scheduledFor
                  ? 'Schedule Email'
                  : 'Send Email'}
          </button>
          {showConfirmSend && (
            <button
              onClick={() => setShowConfirmSend(false)}
              className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 transition"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Send Result */}
        {sendResult && (
          <div className="rounded-2xl bg-green-950/30 border border-green-600/50 p-4">
            <p className="text-green-200">
              Sent: {sendResult.sent} | Failed: {sendResult.failed} | Suppressed:{' '}
              {sendResult.suppressed}
            </p>
          </div>
        )}
      </section>

      {/* Preview Modal */}
      {showEmailPreview && emailPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="sticky top-0 bg-white p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold text-gray-900">Email Preview</h3>
              <button
                onClick={() => setShowEmailPreview(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-600 mb-2">
                <strong>Subject:</strong> {emailPreview.subject}
              </p>
              <div dangerouslySetInnerHTML={{ __html: emailPreview.html }} />
            </div>
          </div>
        </div>
      )}

      {/* Individual Email Modal */}
      {individualEmailTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 w-full max-w-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Send Email</h3>
                <p className="text-sm text-muted">
                  To: {individualEmailTarget.email}
                  {individualEmailTarget.name && ` (${individualEmailTarget.name})`}
                </p>
              </div>
              <button
                onClick={closeIndividualEmailModal}
                className="text-muted hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-muted mb-1">Template</label>
                <select
                  value={individualEmailForm.templateType}
                  onChange={(e) =>
                    setIndividualEmailForm({
                      ...individualEmailForm,
                      templateType: e.target.value as 'announcement' | 'custom',
                    })
                  }
                  className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="announcement">Announcement</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-muted mb-1">Subject</label>
                <input
                  type="text"
                  value={individualEmailForm.subject}
                  onChange={(e) =>
                    setIndividualEmailForm({ ...individualEmailForm, subject: e.target.value })
                  }
                  className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Email subject..."
                />
              </div>

              <div>
                <label className="block text-sm text-muted mb-1">Message</label>
                <textarea
                  value={individualEmailForm.messageHtml}
                  onChange={(e) =>
                    setIndividualEmailForm({ ...individualEmailForm, messageHtml: e.target.value })
                  }
                  rows={6}
                  className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  placeholder="Your message here..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeIndividualEmailModal}
                  className="flex-1 rounded-2xl px-4 py-2 text-sm font-medium text-white bg-surface-2 hover:bg-surface-2/80 border border-app transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendIndividualEmail}
                  disabled={
                    sendingIndividualEmail ||
                    !individualEmailForm.subject ||
                    !individualEmailForm.messageHtml
                  }
                  className="flex-1 rounded-2xl px-4 py-2 text-sm font-medium text-black bg-primary hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {sendingIndividualEmail ? 'Sending...' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scheduled Emails Section */}
      {scheduledEmails.length > 0 && (
        <section className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Email Queue</p>
            <h2 className="text-xl font-semibold text-white">Scheduled Emails</h2>
          </div>

          {loadingScheduled ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-app/50">
                    <th className="text-left py-3 px-4 text-muted font-medium">Subject</th>
                    <th className="text-left py-3 px-4 text-muted font-medium">Scheduled For</th>
                    <th className="text-left py-3 px-4 text-muted font-medium">Recipients</th>
                    <th className="text-left py-3 px-4 text-muted font-medium">Status</th>
                    <th className="text-right py-3 px-4 text-muted font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledEmails.map((email) => (
                    <tr key={email.id} className="border-b border-app/30 hover:bg-surface-2/50">
                      <td className="py-3 px-4 text-white max-w-xs truncate">{email.subject}</td>
                      <td className="py-3 px-4 text-muted">
                        {new Date(email.scheduledFor).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-muted">{email.recipientCount}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            email.status === 'pending'
                              ? 'bg-yellow-600 text-yellow-100'
                              : email.status === 'processing'
                                ? 'bg-blue-600 text-blue-100'
                                : email.status === 'sent'
                                  ? 'bg-green-600 text-green-100'
                                  : email.status === 'cancelled'
                                    ? 'bg-gray-600 text-gray-100'
                                    : 'bg-red-600 text-red-100'
                          }`}
                        >
                          {email.status}
                        </span>
                        {email.status === 'sent' && email.sentCount !== undefined && (
                          <span className="ml-2 text-xs text-muted">
                            ({email.sentCount} sent, {email.failedCount || 0} failed)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {email.status === 'pending' && (
                          <button
                            onClick={() => handleCancelScheduled(email.id)}
                            disabled={cancellingScheduled === email.id}
                            className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition disabled:opacity-50"
                          >
                            {cancellingScheduled === email.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                      setAddUserForm({
                        ...addUserForm,
                        role: e.target.value as 'FREE' | 'PRO' | 'ADMIN',
                      })
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
                  <td className="py-3 px-4 text-white">
                    {u.email}
                    {u.emailUnsubscribed && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">
                        Unsubscribed
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-muted">{u.name || '-'}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(u.role)}`}
                    >
                      {u.role}
                    </span>
                    {u.isFoundingRider && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-600 text-emerald-100">
                        Founding Rider
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-muted">
                    {u.activatedAt ? new Date(u.activatedAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openIndividualEmailModal({ id: u.id, email: u.email, name: u.name })}
                        disabled={u.emailUnsubscribed}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={u.emailUnsubscribed ? 'User has unsubscribed' : 'Send email'}
                      >
                        Email
                      </button>
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
          <div className="flex gap-2">
            {selectedWaitlist.size > 0 && (
              <>
                <button
                  onClick={() => handleBulkToggleFoundingRider(true)}
                  disabled={bulkPromoting}
                  className="rounded-2xl px-4 py-2 text-sm font-medium text-black bg-emerald-500 hover:bg-emerald-400 transition disabled:opacity-50"
                >
                  {bulkPromoting ? 'Updating...' : `Mark ${selectedWaitlist.size} as Founding Riders`}
                </button>
                <button
                  onClick={() => handleBulkToggleFoundingRider(false)}
                  disabled={bulkPromoting}
                  className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-500 transition disabled:opacity-50"
                >
                  Remove Founding Rider
                </button>
              </>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 transition disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-950/30 border border-red-600/50 p-4">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Bulk selection controls */}
        {waitlist.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">
              {selectedWaitlist.size} of {waitlist.length} selected
            </span>
            <button
              onClick={handleSelectAllWaitlist}
              className="text-primary hover:underline"
            >
              Select All
            </button>
            <button
              onClick={handleDeselectAllWaitlist}
              className="text-muted hover:underline"
            >
              Deselect All
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app/50">
                <th className="w-10 py-3 px-4"></th>
                <th className="text-left py-3 px-4 text-muted font-medium">Email</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Name</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Founding Rider</th>
                <th className="text-left py-3 px-4 text-muted font-medium">Signed Up</th>
                <th className="text-right py-3 px-4 text-muted font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.map((entry) => (
                <tr key={entry.id} className="border-b border-app/30 hover:bg-surface-2/50">
                  <td className="py-3 px-4">
                    <input
                      type="checkbox"
                      checked={selectedWaitlist.has(entry.id)}
                      onChange={() => toggleWaitlistSelection(entry.id)}
                      className="rounded border-app"
                    />
                  </td>
                  <td className="py-3 px-4 text-white">
                    {entry.email}
                    {entry.emailUnsubscribed && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">
                        Unsubscribed
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-muted">{entry.name || '-'}</td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleToggleFoundingRider(entry.id, entry.email, entry.isFoundingRider)}
                      disabled={promoting === entry.id}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        entry.isFoundingRider
                          ? 'bg-emerald-600 text-emerald-100 hover:bg-emerald-500'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      } disabled:opacity-50`}
                    >
                      {promoting === entry.id ? '...' : entry.isFoundingRider ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-muted">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openIndividualEmailModal({ id: entry.id, email: entry.email, name: entry.name })}
                        disabled={entry.emailUnsubscribed}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={entry.emailUnsubscribed ? 'User has unsubscribed' : 'Send email'}
                      >
                        Email
                      </button>
                      <button
                        onClick={() => handleActivate(entry.id, entry.email)}
                        disabled={activating === entry.id || deleting === entry.id || promoting === entry.id}
                        className="rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {activating === entry.id ? 'Activating...' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteWaitlist(entry.id, entry.email)}
                        disabled={deleting === entry.id || activating === entry.id || promoting === entry.id}
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
