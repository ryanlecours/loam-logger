import { useState } from 'react';
import { toast } from 'sonner';
import { getAuthHeaders } from '@/lib/csrf';
import DeleteAccountModal from '../../../components/DeleteAccountModal';
import SettingsSectionHeader from '../SettingsSectionHeader';

export default function DangerZoneSection() {
  const [open, setOpen] = useState(false);

  const handleDelete = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/delete-account`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete account');
      }

      setOpen(false);
      toast.success('Account deleted. Redirecting to login…');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1200);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Danger Zone"
        title="Delete Account"
        description="Permanently delete your account and all associated data. This action cannot be undone."
      />
      <div className="panel-danger space-y-4">
        <div>
          <p className="label-section text-danger">Irreversible</p>
          <h2 className="title-section">Delete your account</h2>
        </div>
        <p className="text-body-muted">
          All bikes, components, rides, credentials, and connected services will be removed. You'll be
          signed out and redirected to the login page.
        </p>
        <button type="button" onClick={() => setOpen(true)} className="btn-danger">
          Delete Account
        </button>
      </div>

      <DeleteAccountModal open={open} onClose={() => setOpen(false)} onConfirm={handleDelete} />
    </div>
  );
}
