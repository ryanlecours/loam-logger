import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button } from '@/components/ui';
import { validatePassword, PASSWORD_RULES } from '@loam/shared';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Missing-token and expired-token land on the same UX: the link can't be
  // completed, so offer a fresh reset. Distinguishing the two wouldn't give
  // the user an actionable difference.
  const [expired, setExpired] = useState(!token);

  // If the user is on a phone and arrived from an email link, try to hand off
  // to the app. On iOS with universal links configured, the OS intercepts the
  // https:// link before we even load — this fallback only fires when that
  // didn't happen (app not installed, old build without entitlement, in-app
  // browser, etc.).
  //
  // Gated on `?source=email` so only users arriving from the email attempt the
  // hand-off. Direct visits (typed URL, bookmark, redirect from the expired
  // screen) skip it — otherwise mobile browsers can show "Open in app?"
  // prompts or error dialogs even when the user is intentionally using the
  // web flow.
  useEffect(() => {
    if (!token) return;
    if (searchParams.get('source') !== 'email') return;
    const ua = navigator.userAgent;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    if (!isMobile) return;
    window.location.href = `loamlogger://reset-password?token=${encodeURIComponent(token)}`;
  }, [token, searchParams]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token) return; // Defensive: the form shouldn't render when token is missing.

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      setError(validation.error || 'Password does not meet requirements.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.code === 'TOKEN_EXPIRED') {
          setExpired(true);
          return;
        }
        setError(data.error || 'Failed to reset password.');
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error('[ResetPassword] Network error', err);
      setError('A network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
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

      <motion.div
        className="relative z-10 container px-6 max-w-md w-full"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div
          className="w-full rounded-2xl p-8 space-y-6"
          style={{
            backgroundColor: 'var(--glass)',
            border: '1px solid var(--slate)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="text-center space-y-1">
            <p className="text-xs uppercase tracking-[0.4em]" style={{ color: 'var(--sage)' }}>
              Loam Logger
            </p>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--cream)' }}>
              {expired ? 'Link Expired' : 'Reset Password'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--concrete)' }}>
              {expired
                ? 'This reset link has expired. Request a new one to continue.'
                : success
                  ? 'Your password has been updated. You can now sign in.'
                  : 'Choose a new password for your account.'}
            </p>
          </div>

          {expired ? (
            <div className="space-y-3">
              <Button
                type="button"
                variant="primary"
                className="w-full justify-center text-base"
                onClick={() => navigate('/forgot-password', { replace: true })}
              >
                Request a New Link
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center text-base"
                onClick={() => navigate('/login', { replace: true })}
              >
                Back to Sign In
              </Button>
            </div>
          ) : success ? (
            <Button
              type="button"
              variant="primary"
              className="w-full justify-center text-base"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to Sign In
            </Button>
          ) : (
            <form
              className="space-y-4 p-4 rounded-xl"
              style={{ backgroundColor: 'rgba(54, 60, 57, 0.3)' }}
              onSubmit={handleSubmit}
            >
              {error && (
                <div className="alert alert-danger">
                  <p>{error}</p>
                </div>
              )}

              <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--concrete)' }}>
                New Password
                <input
                  type="password"
                  autoComplete="new-password"
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
                  autoComplete="new-password"
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
                {isLoading ? 'Updating...' : 'Reset Password'}
              </Button>
            </form>
          )}
        </div>
      </motion.div>
    </section>
  );
}
