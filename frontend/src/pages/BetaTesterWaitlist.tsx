import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function BetaTesterWaitlist() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Clear error when user types
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error) setError(null);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (error) setError(null);
  };

  // Validation
  const validate = (): string | null => {
    if (!email.trim()) return 'Email is required';

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Please enter a valid email address';

    if (name.trim().length > 255) return 'Name is too long';

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to join waitlist');
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error('[Waitlist] Network error:', err);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (success) {
    return (
      <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(0,60,30,0.6),_transparent),radial-gradient(circle_at_bottom,_rgba(0,20,10,0.8),_rgb(6,8,6))] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[32px] panel-soft shadow-soft border border-app/80 p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="text-5xl">✓</div>
            <h1 className="text-2xl font-semibold text-white">You're on the list!</h1>
            <p className="text-sm text-muted">
              Thanks for your interest in Loam Logger. We'll email you at <strong className="text-white">{email}</strong> when beta access is ready.
            </p>
          </div>

          <div className="rounded-xl bg-surface-2 p-4 border border-app/40">
            <p className="text-xs text-muted">
              We're rolling out access in waves to ensure quality. Keep an eye on your inbox!
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full py-2 px-4 rounded-full btn-primary font-semibold text-center transition-colors hover:opacity-90"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Form state
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(0,60,30,0.6),_transparent),radial-gradient(circle_at_bottom,_rgba(0,20,10,0.8),_rgb(6,8,6))] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[32px] panel-soft shadow-soft border border-app/80 p-8 space-y-6">
        <div className="text-center space-y-3">
          <div className="text-5xl">🚧</div>
          <h1 className="text-2xl font-semibold text-white">Join the Beta Waitlist</h1>
          <p className="text-sm text-muted">
            Loam Logger is currently in private beta. Sign up below and we'll email you when we're ready for more testers.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-sm text-muted">Email *</label>
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              className="w-full bg-app border border-app rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
              placeholder="you@example.com"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm text-muted">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              className="w-full bg-app border border-app rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]"
              placeholder="Your name"
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="text-sm" style={{ color: 'rgb(var(--danger))' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 rounded-full btn-primary font-semibold text-center transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Joining...' : 'Join Waitlist'}
          </button>
        </form>

        <div className="text-center">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-muted hover:text-white transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
