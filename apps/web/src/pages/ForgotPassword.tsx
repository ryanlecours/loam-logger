import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button } from '@/components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }

    setIsLoading(true);

    try {
      await fetch(`${import.meta.env.VITE_API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // The server always returns 200 to avoid leaking which emails are registered.
      // Show the same confirmation regardless.
      setSubmitted(true);
    } catch (err) {
      console.error('[ForgotPassword] Network error', err);
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
              {submitted ? 'Check Your Email' : 'Forgot Password'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--concrete)' }}>
              {submitted
                ? `If an account exists for that email, we've sent a reset link. It expires in 1 hour.`
                : 'Enter your email and we\u2019ll send you a link to reset your password.'}
            </p>
          </div>

          {submitted ? (
            <Link
              to="/login"
              className="block w-full text-center btn-primary rounded-full px-4 py-3 text-base font-semibold"
            >
              Back to Sign In
            </Link>
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
                Email
                <input
                  type="email"
                  autoComplete="email"
                  className="mt-1 w-full input-soft"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isLoading}
                  required
                />
              </label>

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
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </Button>

              <div className="text-center text-sm" style={{ color: 'var(--concrete)' }}>
                <Link to="/login" className="hover:underline">
                  Back to Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </section>
  );
}
