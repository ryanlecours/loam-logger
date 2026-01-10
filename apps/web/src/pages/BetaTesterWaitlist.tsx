import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import MarketingButton from '../components/marketing/MarketingButton';

export default function BetaTesterWaitlist() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

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
    if (!name.trim()) return 'Name is required';
    if (name.trim().length > 255) return 'Name is too long';

    if (!email.trim()) return 'Email is required';

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Please enter a valid email address';

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
          name: name.trim(),
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
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
        {/* Background Image with Overlay - Desktop */}
        <div className="absolute inset-0 z-0 hidden md:block bg-hero-desktop bg-cover-center bg-fixed">
          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
        </div>

        {/* Background Image with Overlay - Mobile */}
        <div className="absolute inset-0 z-0 md:hidden bg-hero-mobile bg-cover-center">
          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
        </div>

        {/* Login Link */}
        <motion.div
          className="absolute top-6 right-6 z-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          <a
            href="/login"
            className="text-sm text-sand hover:opacity-80 transition-opacity"
          >
            Log In
          </a>
        </motion.div>

        {/* Success Content */}
        <motion.div
          className="relative z-10 container text-center px-6 max-w-2xl"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="text-7xl mb-6 success-icon-animated">✓</div>
          <h1 className="hero-headline mb-6">You're on the list!</h1>
          <p className="body-large text-sand mb-4">
            Thanks for your interest in Loam Logger. We'll email you at{' '}
            <strong className="text-mint">{email}</strong> when beta access is ready.
          </p>

          <div className="info-panel mb-8">
            <p className="body text-concrete">
              We're rolling out access in waves to ensure quality. Keep an eye on your inbox!
            </p>
          </div>

          <MarketingButton href="/" size="lg">
            Back to Home
          </MarketingButton>
        </motion.div>
      </section>
    );
  }

  // Form state
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
      {/* Background Image with Overlay - Desktop */}
      <div className="absolute inset-0 z-0 hidden md:block bg-hero-desktop bg-cover-center bg-fixed">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Background Image with Overlay - Mobile */}
      <div className="absolute inset-0 z-0 md:hidden bg-hero-mobile bg-cover-center">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Login Link */}
      <motion.div
        className="absolute top-6 right-6 z-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.5 }}
      >
        <a
          href="/login"
          className="text-sm text-sand hover:opacity-80 transition-opacity"
        >
          Log In
        </a>
      </motion.div>

      {/* Form Content */}
      <motion.div
        className="relative z-10 container px-6 max-w-xl w-full"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🚧</div>
          <h1 className="hero-headline mb-4">Join the Beta</h1>
          <p className="body-large text-sand">
            Loam Logger is currently in private beta. Sign up below and we'll email you when we're ready for more testers.
          </p>
        </div>

        <motion.form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-2xl p-8 glass-form"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="space-y-2">
            <label className="marketing-label">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              className="marketing-input"
              placeholder="Your name"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="marketing-label">
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              className="marketing-input"
              placeholder="you@example.com"
              disabled={isSubmitting}
              required
            />
          </div>

          {error && (
            <motion.div
              className="alert-inline alert-inline-error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-sm font-medium">
                {error}
              </p>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary text-lg px-8 py-4 w-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Joining...' : 'Join Waitlist'}
          </button>
        </motion.form>

        <motion.div
          className="text-center mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <button
            onClick={() => navigate('/')}
            className="text-sm text-concrete transition-opacity hover:opacity-80"
          >
            ← Back to Home
          </button>
        </motion.div>
      </motion.div>
    </section>
  );
}
