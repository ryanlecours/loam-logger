import { useState, useEffect, useCallback } from 'react';
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

type EmailSegment = 'WAITLIST' | 'WAITLIST_FOUNDING' | 'WAITLIST_REGULAR' | 'ACTIVE_ALL' | 'ACTIVE_FREE' | 'ACTIVE_PRO';

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
  recipientEmails: string[];
  status: 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed';
  createdAt: string;
  sentCount?: number;
  failedCount?: number;
  suppressedCount?: number;
  processedAt?: string;
  errorMessage?: string;
}

interface TemplateParameter {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'hidden';
  required: boolean;
  defaultValue?: string;
  helpText?: string;
}

interface EmailTemplate {
  id: string;
  displayName: string;
  description: string;
  defaultSubject: string;
  parameters: TemplateParameter[];
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
    segment: 'ACTIVE_ALL',
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

  // Unified email template state
  const [availableTemplates, setAvailableTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('announcement');
  const [templateParameters, setTemplateParameters] = useState<Record<string, string>>({});

  // Scheduled emails state
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);
  const [cancellingScheduled, setCancellingScheduled] = useState<string | null>(null);
  const [rescheduleEmail, setRescheduleEmail] = useState<ScheduledEmail | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

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

  // CSV import state
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; email: string; reason: string }>;
  } | null>(null);

  // User lookup state (for finding userId by email)
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: string;
    activatedAt: string | null;
    isFoundingRider: boolean;
  } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!userLoading && isAdmin) {
      fetchStats();
      fetchWaitlist(1);
      fetchUsers(1);
      fetchScheduledEmails();
      fetchTemplates();
    }
  }, [userLoading, isAdmin]);

  const fetchTemplates = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/templates`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch templates');
      const data = await res.json();
      setAvailableTemplates(data.templates);
      // Set default template if available
      if (data.templates.length > 0) {
        const defaultTemplate = data.templates.find((t: EmailTemplate) => t.id === 'announcement') || data.templates[0];
        setSelectedTemplateId(defaultTemplate.id);
        setEmailForm(prev => ({ ...prev, subject: defaultTemplate.defaultSubject }));
        // Initialize parameters with defaults
        const params: Record<string, string> = {};
        defaultTemplate.parameters.forEach((p: TemplateParameter) => {
          if (p.defaultValue) params[p.key] = p.defaultValue;
        });
        setTemplateParameters(params);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = availableTemplates.find(t => t.id === templateId);
    if (template) {
      setEmailForm(prev => ({ ...prev, subject: template.defaultSubject }));
      // Reset parameters to template defaults
      const params: Record<string, string> = {};
      template.parameters.forEach(p => {
        if (p.defaultValue) params[p.key] = p.defaultValue;
      });
      setTemplateParameters(params);
    }
  };

  const updateTemplateParameter = (key: string, value: string) => {
    setTemplateParameters(prev => ({ ...prev, [key]: value }));
  };

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

  // Parse CSV line handling quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
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
  };

  const handleImportCSV = async (file: File) => {
    try {
      setImporting(true);
      setImportResults(null);

      const content = await file.text();
      const lines = content.split(/\r?\n/);

      if (lines.length < 2) {
        alert('CSV file is empty or has no data rows');
        return;
      }

      // Parse header to find column indices
      const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
      const emailIdx = header.findIndex((h) => h.includes('email'));
      const nameIdx = header.findIndex((h) => h.includes('name'));
      const signedUpIdx = header.findIndex((h) => h.includes('signed up') || h.includes('signedup'));

      if (emailIdx === -1) {
        alert('CSV must have an "Email" column');
        return;
      }

      // Parse data rows
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
        alert('No valid users found in CSV');
        return;
      }

      // Send to API
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/waitlist/import`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ users }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to import');
      }

      setImportResults(data);

      // Refresh waitlist if any users were imported
      if (data.imported > 0) {
        fetchWaitlist(1);
        fetchStats();
      }

      // Show summary alert
      let message = `Import complete: ${data.imported} imported`;
      if (data.skipped > 0) message += `, ${data.skipped} skipped (duplicates)`;
      if (data.errors.length > 0) message += `, ${data.errors.length} failed`;
      alert(message);
    } catch (err) {
      console.error('Import failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to import waitlist');
    } finally {
      setImporting(false);
    }
  };

  const handleLookupUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupEmail.trim()) {
      setLookupError('Email is required');
      return;
    }

    try {
      setLookingUp(true);
      setLookupError(null);
      setLookupResult(null);

      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/lookup-user?email=${encodeURIComponent(lookupEmail.trim())}`,
        { credentials: 'include' }
      );

      if (res.status === 404) {
        setLookupError('User not found');
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Lookup failed');
      }

      const user = await res.json();
      setLookupResult(user);
    } catch (err) {
      console.error('Lookup failed:', err);
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookingUp(false);
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
        // Email failed - show warning with temp password for manual sharing
        alert(
          `⚠️ User ${data.user.email} created, but activation email FAILED to send.\n\n` +
            `Please share this temporary password with the user manually:\n\n` +
            `${data.tempPassword}\n\n` +
            `The user must change this password on first login.`
        );
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
        setScheduledEmails(data.emails ?? []);
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

  const openRescheduleModal = (email: ScheduledEmail) => {
    setRescheduleEmail(email);
    // Pre-fill with current scheduled time
    const currentDate = new Date(email.scheduledFor);
    setRescheduleDate(currentDate.toISOString().slice(0, 16));
  };

  const handleReschedule = async () => {
    if (!rescheduleEmail || !rescheduleDate) return;

    try {
      setRescheduling(true);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/scheduled/${rescheduleEmail.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scheduledFor: new Date(rescheduleDate).toISOString() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reschedule email');
      }

      // Refresh the list and close modal
      fetchScheduledEmails();
      setRescheduleEmail(null);
      setRescheduleDate('');
    } catch (err) {
      console.error('Reschedule email failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to reschedule email');
    } finally {
      setRescheduling(false);
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
      case 'ACTIVE_ALL':
        return 'role=FREE&role=PRO';
      case 'ACTIVE_FREE':
        return 'role=FREE';
      case 'ACTIVE_PRO':
        return 'role=PRO';
    }
  };

  const fetchEmailRecipients = useCallback(async (segment: EmailSegment) => {
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
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchEmailRecipients(emailForm.segment);
    }
  }, [isAdmin, emailForm.segment, fetchEmailRecipients]);
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
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/unified/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          templateId: selectedTemplateId,
          subject: emailForm.subject,
          parameters: templateParameters,
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

    try {
      const body: Record<string, unknown> = {
        recipientIds: Array.from(selectedRecipients),
        templateId: selectedTemplateId,
        subject: emailForm.subject,
        parameters: templateParameters,
      };

      if (isScheduled) {
        body.scheduledFor = new Date(emailForm.scheduledFor!).toISOString();
      }

      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/unified/send`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        if (isScheduled) {
          alert(`Email scheduled for ${new Date(emailForm.scheduledFor!).toLocaleString()}`);
          setEmailForm(prev => ({ ...prev, scheduledFor: null }));
          // Reset parameters to defaults
          const template = availableTemplates.find(t => t.id === selectedTemplateId);
          if (template) {
            setEmailForm(prev => ({ ...prev, subject: template.defaultSubject }));
            const params: Record<string, string> = {};
            template.parameters.forEach(p => {
              if (p.defaultValue) params[p.key] = p.defaultValue;
            });
            setTemplateParameters(params);
          }
          fetchScheduledEmails();
        } else {
          setSendResult({ ...data.results, total: data.total });
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
        return 'badge-role badge-role-admin';
      case 'PRO':
        return 'badge-role badge-role-pro';
      default:
        return 'badge-role badge-role-user';
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
    <div className="page-container space-y-8">
      {/* Header */}
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Admin Panel</p>
            <h1 className="text-3xl font-semibold text-white">Loam Logger Admin</h1>
            <p className="text-body-muted max-w-2xl">
              Manage waitlist signups and view platform statistics.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Overview */}
      {stats && (
        <section className="grid gap-6 md:grid-cols-3">
          <div className="panel">
            <p className="label-section">Total Users</p>
            <p className="stat-value">{stats.userCount}</p>
          </div>
          <div className="panel">
            <p className="label-section">Founding Riders</p>
            <p className="stat-value">{stats.foundingRidersCount}</p>
          </div>
          <div className="panel">
            <p className="label-section">Waitlist Signups</p>
            <p className="stat-value">{stats.waitlistCount}</p>
          </div>
        </section>
      )}

      {/* User Lookup Section */}
      <section className="panel-spaced">
        <div>
          <p className="label-section">Developer Tools</p>
          <h2 className="title-section">User Lookup</h2>
          <p className="text-body-muted mt-1">
            Look up a user by email to get their userId (for log filtering in Railway).
          </p>
        </div>

        <form onSubmit={handleLookupUser} className="flex gap-3 items-end">
          <div className="flex-1 max-w-md">
            <label className="label-form">Email Address</label>
            <input
              type="email"
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.target.value)}
              className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="user@example.com"
            />
          </div>
          <button
            type="submit"
            disabled={lookingUp || !lookupEmail.trim()}
            className="btn-primary px-6 py-2 disabled:opacity-50"
          >
            {lookingUp ? 'Looking up...' : 'Lookup'}
          </button>
        </form>

        {lookupError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {lookupError}
          </div>
        )}

        {lookupResult && (
          <div className="p-4 rounded-xl bg-surface-2 border border-app space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">User ID</span>
              <code className="text-sm bg-surface-1 px-2 py-1 rounded font-mono select-all">
                {lookupResult.id}
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Email</span>
              <span className="text-sm">{lookupResult.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Name</span>
              <span className="text-sm">{lookupResult.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Role</span>
              <span className="text-sm">{lookupResult.role}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Founding Rider</span>
              <span className="text-sm">{lookupResult.isFoundingRider ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Created</span>
              <span className="text-sm">{new Date(lookupResult.createdAt).toLocaleDateString()}</span>
            </div>
            {lookupResult.activatedAt && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Activated</span>
                <span className="text-sm">{new Date(lookupResult.activatedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Email Compose Section */}
      <section className="panel-spaced">
        <div>
          <p className="label-section">Bulk Email</p>
          <h2 className="title-section">Send Email</h2>
        </div>

        {/* Segment Selector */}
        <div className="space-y-2">
          <label className="label-form">Recipients</label>
          <div className="flex flex-wrap gap-4">
            {/* Active Users */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emailSegment"
                value="ACTIVE_ALL"
                checked={emailForm.segment === 'ACTIVE_ALL'}
                onChange={() => setEmailForm({ ...emailForm, segment: 'ACTIVE_ALL' })}
                className="text-primary"
              />
              <span className="text-white">Active Users - All</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emailSegment"
                value="ACTIVE_FREE"
                checked={emailForm.segment === 'ACTIVE_FREE'}
                onChange={() => setEmailForm({ ...emailForm, segment: 'ACTIVE_FREE' })}
                className="text-primary"
              />
              <span className="text-white">Active Users - Free</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="emailSegment"
                value="ACTIVE_PRO"
                checked={emailForm.segment === 'ACTIVE_PRO'}
                onChange={() => setEmailForm({ ...emailForm, segment: 'ACTIVE_PRO' })}
                className="text-primary"
              />
              <span className="text-white">Active Users - Pro</span>
            </label>
            {/* Waitlist */}
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
                  <span className="text-xs text-danger ml-auto">unsubscribed</span>
                )}
              </label>
            ))}
            {emailRecipients.length === 0 && !loadingRecipients && (
              <p className="text-center text-muted py-4">No recipients in this segment</p>
            )}
          </div>
        </div>

        {/* Template Selector */}
        <div className="space-y-2">
          <label className="label-form">Template</label>
          <select
            value={selectedTemplateId}
            onChange={(e) => handleTemplateChange(e.target.value)}
            className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.displayName}
              </option>
            ))}
          </select>
          {availableTemplates.find(t => t.id === selectedTemplateId)?.description && (
            <p className="text-sm text-muted">
              {availableTemplates.find(t => t.id === selectedTemplateId)?.description}
            </p>
          )}
        </div>

        {/* Subject */}
        <div>
          <label className="label-form">Subject</label>
          <input
            type="text"
            value={emailForm.subject}
            onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
            className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Email subject..."
          />
        </div>

        {/* Dynamic Template Parameters */}
        {availableTemplates.find(t => t.id === selectedTemplateId)?.parameters.map((param) => (
          <div key={param.key}>
            <label className="label-form">
              {param.label}
              {param.required && <span className="text-danger ml-1">*</span>}
            </label>
            {param.type === 'textarea' ? (
              <textarea
                value={templateParameters[param.key] || ''}
                onChange={(e) => updateTemplateParameter(param.key, e.target.value)}
                rows={6}
                className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                placeholder={param.helpText || `Enter ${param.label.toLowerCase()}...`}
              />
            ) : (
              <input
                type={param.type === 'url' ? 'url' : 'text'}
                value={templateParameters[param.key] || ''}
                onChange={(e) => updateTemplateParameter(param.key, e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder={param.helpText || `Enter ${param.label.toLowerCase()}...`}
              />
            )}
            {param.helpText && param.type !== 'textarea' && (
              <p className="text-xs text-muted mt-1">{param.helpText}</p>
            )}
          </div>
        ))}

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
            disabled={
              !emailForm.subject ||
              (availableTemplates.find(t => t.id === selectedTemplateId)?.parameters
                .filter(p => p.required)
                .some(p => !templateParameters[p.key]?.trim()) ?? false)
            }
            className="rounded-2xl px-4 py-2 text-sm font-medium text-white bg-surface-2 hover:bg-surface-2/80 border border-app transition disabled:opacity-50"
          >
            Preview
          </button>
          <button
            onClick={handleSendEmail}
            disabled={
              !emailForm.subject ||
              sendingEmail ||
              selectedRecipients.size === 0 ||
              (availableTemplates.find(t => t.id === selectedTemplateId)?.parameters
                .filter(p => p.required)
                .some(p => !templateParameters[p.key]?.trim()) ?? false)
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
              className="btn-danger"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Send Result */}
        {sendResult && (
          <div className="alert alert-success-dark rounded-2xl">
            <p>
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
          <div className="panel w-full max-w-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Send Email</h3>
                <p className="text-body-muted">
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
                <label className="label-form">Template</label>
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
                <label className="label-form">Subject</label>
                <input
                  type="text"
                  value={individualEmailForm.subject}
                  onChange={(e) =>
                    setIndividualEmailForm({ ...individualEmailForm, subject: e.target.value })
                  }
                  className="input-soft"
                  placeholder="Email subject..."
                />
              </div>

              <div>
                <label className="label-form">Message</label>
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
        <section className="panel-spaced">
          <div>
            <p className="label-section">Email Queue</p>
            <h2 className="title-section">Scheduled Emails</h2>
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
                    <th className="text-left py-3 px-4 text-muted font-medium">To</th>
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
                      <td className="py-3 px-4 text-muted max-w-xs">
                        {email.recipientEmails.length <= 3 ? (
                          <span className="truncate block" title={email.recipientEmails.join(', ')}>
                            {email.recipientEmails.join(', ')}
                          </span>
                        ) : (
                          <span title={email.recipientEmails.join(', ')}>
                            {email.recipientEmails.slice(0, 2).join(', ')} +{email.recipientEmails.length - 2} more
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted">{email.recipientCount}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            email.status === 'pending'
                              ? 'bg-warning text-warning-foreground'
                              : email.status === 'processing'
                                ? 'bg-info text-info-foreground'
                                : email.status === 'sent'
                                  ? 'bg-success text-success-foreground'
                                  : email.status === 'cancelled'
                                    ? 'bg-surface-2 text-muted'
                                    : 'bg-danger text-danger-foreground'
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
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => openRescheduleModal(email)}
                              className="btn-secondary btn-sm"
                            >
                              Reschedule
                            </button>
                            <button
                              onClick={() => handleCancelScheduled(email.id)}
                              disabled={cancellingScheduled === email.id}
                              className="btn-danger btn-sm"
                            >
                              {cancellingScheduled === email.id ? 'Cancelling...' : 'Cancel'}
                            </button>
                          </div>
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

      {/* Reschedule Modal */}
      {rescheduleEmail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="panel w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Reschedule Email</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted mb-1">Subject</p>
                <p className="text-white">{rescheduleEmail.subject}</p>
              </div>
              <div>
                <p className="text-sm text-muted mb-1">Recipients</p>
                <p className="text-white text-sm">
                  {rescheduleEmail.recipientEmails.length <= 5
                    ? rescheduleEmail.recipientEmails.join(', ')
                    : `${rescheduleEmail.recipientEmails.slice(0, 4).join(', ')} +${rescheduleEmail.recipientEmails.length - 4} more`}
                </p>
              </div>
              <div>
                <label className="block text-sm text-muted mb-1">New Scheduled Time</label>
                <input
                  type="datetime-local"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="w-full px-3 py-2 rounded-lg border border-app bg-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setRescheduleEmail(null);
                    setRescheduleDate('');
                  }}
                  className="btn-secondary flex-1"
                  disabled={rescheduling}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReschedule}
                  disabled={rescheduling || !rescheduleDate}
                  className="btn-primary flex-1"
                >
                  {rescheduling ? 'Rescheduling...' : 'Reschedule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Users Table */}
      <section className="panel-spaced">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Active Users</p>
            <h2 className="title-section">User Management</h2>
          </div>
          <button
            onClick={() => setShowAddUserForm(true)}
            className="btn-success"
          >
            + Add User
          </button>
        </div>

        {/* Add User Modal */}
        {showAddUserForm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="panel w-full max-w-md mx-4">
              <h3 className="text-lg font-semibold text-white mb-4">Add New User</h3>
              <form onSubmit={handleAddUser} className="space-y-4">
                <div>
                  <label className="label-form">Email *</label>
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
                  <label className="label-form">Name</label>
                  <input
                    type="text"
                    value={addUserForm.name}
                    onChange={(e) => setAddUserForm({ ...addUserForm, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl bg-surface-2 border border-app text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="label-form">Role</label>
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
                    className="flex-1 btn-success disabled:opacity-50"
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
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-danger/30 text-danger">
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
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-success text-success-foreground">
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
                        className="btn-sm rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-info hover:bg-info/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={u.emailUnsubscribed ? 'User has unsubscribed' : 'Send email'}
                      >
                        Email
                      </button>
                      <button
                        onClick={() => handleDemoteUser(u.id, u.email)}
                        disabled={demoting === u.id || deleting === u.id || u.id === user?.id}
                        className="btn-warning btn-sm"
                        title={u.id === user?.id ? "Can't demote yourself" : 'Demote to waitlist'}
                      >
                        {demoting === u.id ? 'Demoting...' : 'Demote'}
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id, u.email)}
                        disabled={deleting === u.id || demoting === u.id || u.id === user?.id}
                        className="btn-danger btn-sm"
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
      <section className="panel-spaced">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Beta Waitlist</p>
            <h2 className="title-section">Email Signups</h2>
          </div>
          <div className="flex gap-2">
            {selectedWaitlist.size > 0 && (
              <>
                <button
                  onClick={() => handleBulkToggleFoundingRider(true)}
                  disabled={bulkPromoting}
                  className="btn-success disabled:opacity-50"
                >
                  {bulkPromoting ? 'Updating...' : `Mark ${selectedWaitlist.size} as Founding Riders`}
                </button>
                <button
                  onClick={() => handleBulkToggleFoundingRider(false)}
                  disabled={bulkPromoting}
                  className="btn-secondary disabled:opacity-50"
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
            <input
              type="file"
              id="csv-import"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImportCSV(file);
                  e.target.value = ''; // Reset to allow re-importing same file
                }
              }}
            />
            <button
              onClick={() => document.getElementById('csv-import')?.click()}
              disabled={importing}
              className="btn-success disabled:opacity-50"
            >
              {importing ? 'Importing...' : 'Import CSV'}
            </button>
          </div>
        </div>

        {/* Import results summary */}
        {importResults && (
          <div className="rounded-2xl bg-surface-2/50 border border-app/50 p-4">
            <p className="text-white font-medium mb-2">Import Results</p>
            <div className="flex gap-4 text-sm">
              <span className="text-success">{importResults.imported} imported</span>
              {importResults.skipped > 0 && (
                <span className="text-warning">{importResults.skipped} skipped (duplicates)</span>
              )}
              {importResults.errors.length > 0 && (
                <span className="text-danger">{importResults.errors.length} failed</span>
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
                      Row {err.row}: {err.email || '(no email)'} - {err.reason}
                    </li>
                  ))}
                  {importResults.errors.length > 10 && (
                    <li className="text-muted">...and {importResults.errors.length - 10} more</li>
                  )}
                </ul>
              </details>
            )}
            <button
              onClick={() => setImportResults(null)}
              className="mt-2 text-xs text-muted hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="alert alert-danger-dark rounded-2xl">
            <p>{error}</p>
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
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-danger/30 text-danger">
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
                          ? 'bg-success text-success-foreground hover:bg-success/80'
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
                        className="btn-sm rounded-xl px-3 py-1.5 text-xs font-medium text-white bg-info hover:bg-info/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={entry.emailUnsubscribed ? 'User has unsubscribed' : 'Send email'}
                      >
                        Email
                      </button>
                      <button
                        onClick={() => handleActivate(entry.id, entry.email)}
                        disabled={activating === entry.id || deleting === entry.id || promoting === entry.id}
                        className="btn-success btn-sm"
                      >
                        {activating === entry.id ? 'Activating...' : 'Activate'}
                      </button>
                      <button
                        onClick={() => handleDeleteWaitlist(entry.id, entry.email)}
                        disabled={deleting === entry.id || activating === entry.id || promoting === entry.id}
                        className="btn-danger btn-sm"
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
