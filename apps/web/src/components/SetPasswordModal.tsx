import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Modal, Button } from './ui';
import { validatePassword, PASSWORD_RULES } from '@loam/shared';
import { getAuthHeaders } from '@/lib/csrf';

type SetPasswordModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function SetPasswordModal({
  open,
  onClose,
  onSuccess,
}: SetPasswordModalProps) {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    if (isLoading) return;
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      setError(validation.error || 'Password does not meet requirements.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/password/add`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();

        if (data.code === 'RECENT_AUTH_REQUIRED') {
          setError('For security, please log in again to set your password.');
          redirectTimeoutRef.current = setTimeout(() => {
            navigate('/login?returnTo=/settings');
          }, 2000);
          return;
        }

        if (data.code === 'ALREADY_HAS_PASSWORD') {
          setError('You already have a password set. Use "Change Password" instead.');
          return;
        }

        if (res.status === 429) {
          setError('Too many attempts. Please try again later.');
          return;
        }

        setError(data.error || 'Failed to set password.');
        return;
      }

      toast.success('Password added successfully', {
        description: 'You can now sign in with your email and password.',
        duration: 5000,
      });
      setNewPassword('');
      setConfirmPassword('');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('[SetPasswordModal] Network error', err);
      setError('A network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title="Set Password"
      subtitle="Add a password to sign in with email"
      size="sm"
      preventClose={isLoading}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isLoading || !newPassword || !confirmPassword}
          >
            {isLoading ? 'Setting...' : 'Set Password'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="alert-danger-dark">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
          New Password
          <input
            type="password"
            className="mt-1 w-full input-soft"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            disabled={isLoading}
          />
        </label>

        <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
          Confirm Password
          <input
            type="password"
            className="mt-1 w-full input-soft"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            disabled={isLoading}
          />
        </label>

        <div className="text-xs" style={{ color: 'var(--concrete)' }}>
          <p className="font-medium mb-1">Password requirements:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule.key}>{rule.label}</li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
