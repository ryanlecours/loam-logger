import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Modal, Button } from './ui';
import type { PendingProviderLink } from '@/lib/providerLink';

type ProviderLinkModalProps = {
  pending: PendingProviderLink | null;
  onClose: () => void;
  /** Called with the CSRF token once the account is linked and signed in. */
  onLinked: (csrfToken: string | undefined) => void;
};

const PROVIDER_NAME = { google: 'Google', apple: 'Apple' } as const;

/**
 * Shown when a Google sign-in matches an account that already has a
 * password but never confirmed its email. Entering the password proves the
 * rider made that account, which is what makes linking safe. Forgot-password
 * proves the inbox instead, and also replaces the password of anyone else
 * who might have signed up with this address.
 */
export default function ProviderLinkModal({ pending, onClose, onLinked }: ProviderLinkModalProps) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const providerName = pending ? PROVIDER_NAME[pending.provider] : 'Google';

  const handleClose = () => {
    if (isLoading) return;
    setPassword('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!pending || !password) return;
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/link-provider`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkToken: pending.linkToken, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.code === 'LINK_EXPIRED') {
          setError(`That took a little too long. Close this and sign in with ${providerName} again.`);
          return;
        }
        setError(data.error || 'Could not connect your account. Please try again.');
        return;
      }

      setPassword('');
      onLinked(data.csrfToken);
    } catch (err) {
      console.error('[ProviderLinkModal] Network error', err);
      setError('A network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={!!pending}
      onClose={handleClose}
      title={`Connect ${providerName}`}
      subtitle={pending ? `${pending.email} already has a Loam Logger password` : undefined}
      size="sm"
      preventClose={isLoading}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={isLoading || !password}>
            {isLoading ? 'Connecting...' : `Connect ${providerName}`}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--concrete)' }}>
          Enter that password once to connect {providerName}. After that, either way of signing in works.
        </p>

        {error && (
          <div className="alert-danger-dark" role="alert">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full input-soft"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
        </label>

        <div className="text-right text-sm">
          <button
            type="button"
            onClick={() => navigate('/forgot-password')}
            disabled={isLoading}
            className="hover:underline"
            style={{ color: 'var(--sage)' }}
          >
            Forgot password?
          </button>
        </div>
      </form>
    </Modal>
  );
}
