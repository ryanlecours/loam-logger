import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button } from '@/components/ui';
import { validatePassword, PASSWORD_RULES } from '@loam/shared';

export default function ChangePassword() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    // Validate password requirements using shared validation
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      setError(validation.error || 'Password does not meet requirements.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to change password');
        return;
      }

      // Success - redirect to dashboard
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error('[ChangePassword] Network error', err);
      setError('A network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
      {/* Background Image with Overlay - Desktop */}
      <div
        className="absolute inset-0 z-0 hidden md:block"
        style={{
          backgroundImage: 'url(/mtbLandingPhoto.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Background Image with Overlay - Mobile */}
      <div
        className="absolute inset-0 z-0 md:hidden"
        style={{
          backgroundImage: 'url(/mtbLandingPhotoMobile.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Change Password Form Content */}
      <motion.div
        className="relative z-10 container px-6 max-w-md w-full"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="w-full rounded-2xl p-8 space-y-6" style={{
          backgroundColor: 'var(--glass)',
          border: '1px solid var(--slate)',
          backdropFilter: 'blur(12px)',
        }}>
          <div className="text-center space-y-1">
            <p className="text-xs uppercase tracking-[0.4em]" style={{ color: 'var(--sage)' }}>Loam Logger</p>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--cream)' }}>Set Your Password</h1>
            <p className="text-sm" style={{ color: 'var(--concrete)' }}>
              Please create a new password to secure your account.
            </p>
          </div>

          <form className="space-y-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(54, 60, 57, 0.3)' }} onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
              Temporary Password
              <input
                type="password"
                className="mt-1 w-full input-soft"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="From your activation email"
                disabled={isLoading}
                required
              />
            </label>

            <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
              New Password
              <input
                type="password"
                className="mt-1 w-full input-soft"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                disabled={isLoading}
                required
              />
            </label>

            <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
              Confirm New Password
              <input
                type="password"
                className="mt-1 w-full input-soft"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                disabled={isLoading}
                required
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

            {isLoading && (
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center text-base"
              disabled={isLoading}
            >
              {isLoading ? 'Updating...' : 'Set New Password'}
            </Button>
          </form>
        </div>
      </motion.div>
    </section>
  );
}
