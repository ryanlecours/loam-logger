import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea, Select } from '../../../components/ui/Input';
import { getAuthHeaders } from '@/lib/csrf';
import { AdminTable } from '../components/AdminTable';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { StatusPill } from '../components/StatusPill';
import { EmailPreviewModal } from './components/EmailPreviewModal';
import { RescheduleModal } from './components/RescheduleModal';
import type {
  EmailRecipient,
  EmailSegment,
  EmailTemplate,
  ScheduledEmail,
  SendResult,
  TemplateParameter,
} from '../types';

const SEGMENT_OPTIONS: { id: EmailSegment; label: string; group: 'active' | 'waitlist' }[] = [
  { id: 'ACTIVE_ALL', label: 'All Active Users', group: 'active' },
  { id: 'ACTIVE_FREE', label: 'Free', group: 'active' },
  { id: 'ACTIVE_PRO', label: 'Pro', group: 'active' },
  { id: 'WAITLIST', label: 'All Waitlist', group: 'waitlist' },
  { id: 'WAITLIST_FOUNDING', label: 'Founding Riders', group: 'waitlist' },
  { id: 'WAITLIST_REGULAR', label: 'Non-Founding', group: 'waitlist' },
];

const SCHEDULED_COLUMNS = [
  { key: 'subject', label: 'Subject' },
  { key: 'scheduled', label: 'Scheduled For' },
  { key: 'to', label: 'To' },
  { key: 'count', label: 'Recipients' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Action', align: 'right' as const },
];

function getEmailApiParams(segment: EmailSegment): string {
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
}

function getDefaultScheduleTime() {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0, 0, 0);
  return now.toISOString().slice(0, 16);
}

function getMinDatetime() {
  return new Date().toISOString().slice(0, 16);
}

export function EmailSection() {
  // Compose form state
  const [segment, setSegment] = useState<EmailSegment>('ACTIVE_ALL');
  const [subject, setSubject] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('announcement');
  const [templateParameters, setTemplateParameters] = useState<Record<string, string>>({});

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  // Scheduled emails table state
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);
  const [cancellingScheduled, setCancellingScheduled] = useState<string | null>(null);
  const [rescheduleEmail, setRescheduleEmail] = useState<ScheduledEmail | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ScheduledEmail | null>(null);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // Initial fetches
  useEffect(() => {
    fetchTemplates();
    fetchScheduledEmails();
  }, []);

  // Re-fetch recipients whenever the segment changes
  const fetchRecipients = useCallback(async (next: EmailSegment) => {
    setLoadingRecipients(true);
    try {
      const params = getEmailApiParams(next);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/recipients?${params}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setRecipients(data.users);
        // Pre-select non-unsubscribed users.
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
    fetchRecipients(segment);
  }, [segment, fetchRecipients]);

  const fetchTemplates = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/templates`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to fetch templates');
      const data = await res.json();
      setTemplates(data.templates);
      if (data.templates.length > 0) {
        const def =
          data.templates.find((t: EmailTemplate) => t.id === 'announcement') ??
          data.templates[0];
        setSelectedTemplateId(def.id);
        setSubject(def.defaultSubject);
        const params: Record<string, string> = {};
        def.parameters.forEach((p: TemplateParameter) => {
          if (p.defaultValue) params[p.key] = p.defaultValue;
        });
        setTemplateParameters(params);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    }
  };

  const fetchScheduledEmails = async () => {
    setLoadingScheduled(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/scheduled`,
        { credentials: 'include' },
      );
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

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find((tpl) => tpl.id === id);
    if (t) {
      setSubject(t.defaultSubject);
      const params: Record<string, string> = {};
      t.parameters.forEach((p) => {
        if (p.defaultValue) params[p.key] = p.defaultValue;
      });
      setTemplateParameters(params);
    }
  };

  const updateTemplateParameter = (key: string, value: string) => {
    setTemplateParameters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const eligibleRecipientCount = recipients.filter((r) => !r.emailUnsubscribed).length;
  const requiredParamsMissing =
    selectedTemplate?.parameters
      .filter((p) => p.required)
      .some((p) => !templateParameters[p.key]?.trim()) ?? false;

  const handlePreview = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/unified/preview`,
        {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            templateId: selectedTemplateId,
            subject,
            parameters: templateParameters,
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
        setPreviewOpen(true);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to generate preview');
      }
    } catch (err) {
      console.error('Email preview failed:', err);
      toast.error('Failed to generate preview');
    }
  };

  const handleSend = async () => {
    if (!showConfirmSend) {
      setShowConfirmSend(true);
      return;
    }
    setSending(true);
    setShowConfirmSend(false);
    setSendResult(null);

    const isScheduled = !!scheduledFor;

    try {
      const body: Record<string, unknown> = {
        recipientIds: Array.from(selectedRecipients),
        templateId: selectedTemplateId,
        subject,
        parameters: templateParameters,
      };
      if (isScheduled) {
        body.scheduledFor = new Date(scheduledFor!).toISOString();
      }

      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/unified/send`,
        {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error || `Failed to ${isScheduled ? 'schedule' : 'send'} emails`,
        );
        return;
      }

      if (isScheduled) {
        toast.success(
          `Email scheduled for ${new Date(scheduledFor!).toLocaleString()}`,
        );
        setScheduledFor(null);
        if (selectedTemplate) {
          setSubject(selectedTemplate.defaultSubject);
          const params: Record<string, string> = {};
          selectedTemplate.parameters.forEach((p) => {
            if (p.defaultValue) params[p.key] = p.defaultValue;
          });
          setTemplateParameters(params);
        }
        fetchScheduledEmails();
      } else {
        setSendResult({ ...data.results, total: data.total });
      }
    } catch (err) {
      console.error('Send email failed:', err);
      toast.error(`Failed to ${isScheduled ? 'schedule' : 'send'} emails`);
    } finally {
      setSending(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    try {
      setCancellingScheduled(cancelTarget.id);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/scheduled/${cancelTarget.id}`,
        { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel scheduled email');
      }
      setCancelTarget(null);
      fetchScheduledEmails();
    } catch (err) {
      console.error('Cancel scheduled email failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to cancel scheduled email');
    } finally {
      setCancellingScheduled(null);
    }
  };

  return (
    <>
      <section className="panel-spaced">
        <div>
          <p className="label-section">Bulk Email</p>
          <h1 className="text-3xl font-semibold text-white">Email</h1>
          <p className="text-body-muted mt-1">
            Compose and send a templated email to a segment of users — or schedule it for later.
          </p>
        </div>

        {/* Segment selector */}
        <div className="space-y-2">
          <span className="label-form block">Recipients Segment</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SEGMENT_OPTIONS.map((opt) => {
              const isActive = segment === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSegment(opt.id)}
                  aria-pressed={isActive}
                  className={[
                    'flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-sm transition text-left',
                    isActive
                      ? 'bg-surface-2 border-app text-white shadow-[inset_0_0_0_1px_rgba(156,176,164,0.18)]'
                      : 'bg-transparent border-app/50 text-muted hover:text-white/90 hover:border-app',
                  ].join(' ')}
                >
                  <span>{opt.label}</span>
                  <span
                    className={[
                      'text-xs px-2 py-0.5 rounded-full uppercase tracking-wide',
                      opt.group === 'active'
                        ? 'bg-primary/15 text-[color:var(--mint)]'
                        : 'bg-warning/15 text-warning',
                    ].join(' ')}
                  >
                    {opt.group}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recipient list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              {loadingRecipients
                ? 'Loading…'
                : `${selectedRecipients.size} of ${eligibleRecipientCount} selected`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelectedRecipients(
                    new Set(
                      recipients
                        .filter((r) => !r.emailUnsubscribed)
                        .map((r) => r.id),
                    ),
                  )
                }
                className="text-xs text-primary hover:underline"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setSelectedRecipients(new Set())}
                className="text-xs text-muted hover:underline"
              >
                Deselect All
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-xl bg-surface-2 border border-app p-2 space-y-1">
            {recipients.map((recipient) => (
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
            {recipients.length === 0 && !loadingRecipients && (
              <p className="text-center text-muted py-4">No recipients in this segment</p>
            )}
          </div>
        </div>

        {/* Template */}
        <Select
          label="Template"
          value={selectedTemplateId}
          onChange={(e) => handleTemplateChange(e.target.value)}
          hint={selectedTemplate?.description}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.displayName}
            </option>
          ))}
        </Select>

        {/* Subject */}
        <Input
          label="Subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject…"
        />

        {/* Dynamic template parameters */}
        {selectedTemplate?.parameters.map((param) => (
          <div key={param.key}>
            {param.type === 'textarea' ? (
              <Textarea
                label={`${param.label}${param.required ? ' *' : ''}`}
                value={templateParameters[param.key] || ''}
                onChange={(e) => updateTemplateParameter(param.key, e.target.value)}
                rows={6}
                placeholder={
                  param.helpText || `Enter ${param.label.toLowerCase()}…`
                }
              />
            ) : (
              <Input
                label={`${param.label}${param.required ? ' *' : ''}`}
                type={param.type === 'url' ? 'url' : 'text'}
                value={templateParameters[param.key] || ''}
                onChange={(e) => updateTemplateParameter(param.key, e.target.value)}
                placeholder={
                  param.helpText || `Enter ${param.label.toLowerCase()}…`
                }
                hint={param.helpText}
              />
            )}
          </div>
        ))}

        {/* Schedule */}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!scheduledFor}
              onChange={(e) =>
                setScheduledFor(e.target.checked ? getDefaultScheduleTime() : null)
              }
              className="rounded border-app"
            />
            <span className="text-white">Schedule for later</span>
          </label>
          {scheduledFor && (
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={getMinDatetime()}
              className="input-soft max-w-xs"
              aria-label="Scheduled send time"
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={!subject || requiredParamsMissing}
          >
            Preview
          </Button>
          <Button
            onClick={handleSend}
            disabled={
              !subject ||
              sending ||
              selectedRecipients.size === 0 ||
              requiredParamsMissing
            }
          >
            {sending
              ? scheduledFor
                ? 'Scheduling…'
                : 'Sending…'
              : showConfirmSend
                ? `Confirm ${scheduledFor ? 'Schedule' : 'Send'} to ${selectedRecipients.size} recipients`
                : scheduledFor
                  ? 'Schedule Email'
                  : 'Send Email'}
          </Button>
          {showConfirmSend && (
            <button
              type="button"
              onClick={() => setShowConfirmSend(false)}
              className="btn-danger"
            >
              Cancel
            </button>
          )}
        </div>

        {sendResult && (
          <div className="alert alert-success-dark rounded-2xl">
            <p>
              Sent: {sendResult.sent} | Failed: {sendResult.failed} | Suppressed:{' '}
              {sendResult.suppressed}
            </p>
          </div>
        )}
      </section>

      {/* Scheduled emails (only when there are any) */}
      {scheduledEmails.length > 0 && (
        <section className="panel-spaced">
          <div>
            <p className="label-section">Email Queue</p>
            <h2 className="title-section">Scheduled Emails</h2>
          </div>

          <AdminTable
            columns={SCHEDULED_COLUMNS}
            rowCount={scheduledEmails.length}
            loading={loadingScheduled && scheduledEmails.length === 0}
            empty="No scheduled emails."
          >
            {scheduledEmails.map((email) => (
              <tr
                key={email.id}
                className="border-b border-app/30 hover:bg-surface-2/50"
              >
                <td className="py-3 px-4 text-white max-w-xs truncate">
                  {email.subject}
                </td>
                <td className="py-3 px-4 text-muted">
                  {new Date(email.scheduledFor).toLocaleString()}
                </td>
                <td className="py-3 px-4 text-muted max-w-xs">
                  {email.recipientEmails.length <= 3 ? (
                    <span
                      className="truncate block"
                      title={email.recipientEmails.join(', ')}
                    >
                      {email.recipientEmails.join(', ')}
                    </span>
                  ) : (
                    <span title={email.recipientEmails.join(', ')}>
                      {email.recipientEmails.slice(0, 2).join(', ')} +
                      {email.recipientEmails.length - 2} more
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-muted">{email.recipientCount}</td>
                <td className="py-3 px-4">
                  <StatusPill status={email.status} />
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
                        type="button"
                        onClick={() => setRescheduleEmail(email)}
                        className="btn-secondary btn-sm"
                      >
                        Reschedule
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelTarget(email)}
                        disabled={cancellingScheduled === email.id}
                        className="btn-danger btn-sm"
                      >
                        {cancellingScheduled === email.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </AdminTable>
        </section>
      )}

      <EmailPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={preview}
      />

      <RescheduleModal
        email={rescheduleEmail}
        onClose={() => setRescheduleEmail(null)}
        onRescheduled={fetchScheduledEmails}
      />

      <ConfirmDeleteModal
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancel}
        title="Cancel scheduled email"
        message={
          cancelTarget && (
            <>
              Cancel the scheduled email{' '}
              <strong className="text-white">&ldquo;{cancelTarget.subject}&rdquo;</strong>?
              It won&rsquo;t be sent. This action cannot be undone.
            </>
          )
        }
        confirmLabel="Cancel email"
        loading={cancellingScheduled !== null}
      />
    </>
  );
}
