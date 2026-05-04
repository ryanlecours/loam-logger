import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea, Select } from '../../../components/ui/Input';
import { getAuthHeaders } from '@/lib/csrf';

export type IndividualEmailTarget = {
  id: string;
  email: string;
  name: string | null;
};

type Props = {
  target: IndividualEmailTarget | null;
  onClose: () => void;
};

/**
 * One-off email composer used by both the Users and Waitlist tables.
 * Lifted out of the per-section files because both call sites had identical
 * markup and state in the old Admin.tsx — keeping it in one place means a
 * change to the form (e.g. adding a new template choice) lands once.
 */
export function IndividualEmailModal({ target, onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [messageHtml, setMessageHtml] = useState('');
  const [templateType, setTemplateType] = useState<'announcement' | 'custom'>('announcement');
  const [sending, setSending] = useState(false);

  // Reset form whenever the modal closes / opens for a new target — without
  // this, opening the modal for user B would inherit user A's draft.
  useEffect(() => {
    if (!target) {
      setSubject('');
      setMessageHtml('');
      setTemplateType('announcement');
    }
  }, [target]);

  const isOpen = target !== null;

  const handleSend = async () => {
    if (!target) return;
    setSending(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/email/send`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userIds: [target.id],
          templateType,
          subject,
          messageHtml,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Email sent to ${target.email}.`);
        onClose();
      } else {
        toast.error(data.error || 'Failed to send email');
      }
    } catch (err) {
      console.error('Individual email failed:', err);
      toast.error('Failed to send email');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={sending ? () => undefined : onClose}
      title="Send Email"
      subtitle={target ? `To: ${target.email}${target.name ? ` (${target.name})` : ''}` : undefined}
      size="md"
      preventClose={sending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !subject || !messageHtml}
          >
            {sending ? 'Sending…' : 'Send Email'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Template"
          value={templateType}
          onChange={(e) => setTemplateType(e.target.value as 'announcement' | 'custom')}
        >
          <option value="announcement">Announcement</option>
          <option value="custom">Custom</option>
        </Select>

        <Input
          label="Subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject…"
        />

        <Textarea
          label="Message"
          value={messageHtml}
          onChange={(e) => setMessageHtml(e.target.value)}
          rows={6}
          placeholder="Your message here…"
        />
      </div>
    </Modal>
  );
}
