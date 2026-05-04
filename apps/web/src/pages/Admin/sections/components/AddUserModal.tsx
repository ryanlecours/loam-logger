import { useEffect, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { Input, Select } from '../../../../components/ui/Input';
import { getAuthHeaders } from '@/lib/csrf';

type Role = 'FREE' | 'PRO' | 'ADMIN';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful create so the parent can refresh. */
  onCreated: () => void;
};

const initialForm = { email: '', name: '', role: 'FREE' as Role, sendActivationEmail: true };

export function AddUserModal({ isOpen, onClose, onCreated }: Props) {
  const [form, setForm] = useState(initialForm);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isOpen) setForm(initialForm);
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim()) {
      alert('Email is required');
      return;
    }
    try {
      setAdding(true);
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/users`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      if (data.emailQueued) {
        alert(`User ${data.user.email} created! Activation email sent.`);
      } else if (data.tempPassword) {
        // Email failed — surface the temp password so the admin can share it
        // out-of-band. Without this they'd be silently unable to log in.
        alert(
          `⚠️ User ${data.user.email} created, but activation email FAILED to send.\n\n` +
            `Please share this temporary password with the user manually:\n\n` +
            `${data.tempPassword}\n\n` +
            `The user must change this password on first login.`,
        );
      } else {
        alert(`User ${data.user.email} created successfully!`);
      }

      onCreated();
      onClose();
    } catch (err) {
      console.error('Add user failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={adding ? () => undefined : onClose}
      title="Add New User"
      size="md"
      preventClose={adding}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={adding}>
            Cancel
          </Button>
          <button
            form="admin-add-user-form"
            type="submit"
            disabled={adding}
            className="btn-success disabled:opacity-50"
          >
            {adding ? 'Creating…' : 'Create User'}
          </button>
        </>
      }
    >
      <form id="admin-add-user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email *"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="user@example.com"
          autoComplete="off"
        />
        <Input
          label="Name"
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="John Doe"
          autoComplete="off"
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
        >
          <option value="FREE">Free</option>
          <option value="PRO">Pro</option>
          <option value="ADMIN">Admin</option>
        </Select>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.sendActivationEmail}
            onChange={(e) => setForm({ ...form, sendActivationEmail: e.target.checked })}
            className="rounded border-app"
          />
          <span className="text-sm text-muted">
            Send activation email with temporary password
          </span>
        </label>
      </form>
    </Modal>
  );
}
