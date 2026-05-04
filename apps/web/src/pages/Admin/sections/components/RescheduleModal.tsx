import { useEffect, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { getAuthHeaders } from '@/lib/csrf';

type ScheduledEmailLite = {
  id: string;
  subject: string;
  scheduledFor: string;
  recipientEmails: string[];
};

type Props = {
  email: ScheduledEmailLite | null;
  onClose: () => void;
  onRescheduled: () => void;
};

/**
 * Modal for editing the scheduledFor of a pending scheduled email. Opens
 * pre-filled with the current time and disallows scheduling in the past.
 */
export function RescheduleModal({ email, onClose, onRescheduled }: Props) {
  const [scheduledFor, setScheduledFor] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (email) {
      // Pre-fill with the current scheduled time, formatted for `<input type="datetime-local">`.
      setScheduledFor(new Date(email.scheduledFor).toISOString().slice(0, 16));
    } else {
      setScheduledFor('');
    }
  }, [email]);

  const handleSubmit = async () => {
    if (!email || !scheduledFor) return;
    try {
      setSubmitting(true);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/email/scheduled/${email.id}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledFor: new Date(scheduledFor).toISOString() }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reschedule email');
      }
      onRescheduled();
      onClose();
    } catch (err) {
      console.error('Reschedule email failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to reschedule email');
    } finally {
      setSubmitting(false);
    }
  };

  const recipientsPreview = email
    ? email.recipientEmails.length <= 5
      ? email.recipientEmails.join(', ')
      : `${email.recipientEmails.slice(0, 4).join(', ')} +${
          email.recipientEmails.length - 4
        } more`
    : '';

  return (
    <Modal
      isOpen={email !== null}
      onClose={submitting ? () => undefined : onClose}
      title="Reschedule Email"
      size="md"
      preventClose={submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !scheduledFor}>
            {submitting ? 'Rescheduling…' : 'Reschedule'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {email && (
          <>
            <div>
              <p className="text-sm text-muted mb-1">Subject</p>
              <p className="text-white">{email.subject}</p>
            </div>
            <div>
              <p className="text-sm text-muted mb-1">Recipients</p>
              <p className="text-white text-sm">{recipientsPreview}</p>
            </div>
          </>
        )}
        <div>
          <label className="label-form" htmlFor="reschedule-datetime">
            New Scheduled Time
          </label>
          <input
            id="reschedule-datetime"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="input-soft"
          />
        </div>
      </div>
    </Modal>
  );
}
