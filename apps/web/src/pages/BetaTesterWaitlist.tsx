import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { ME_QUERY } from '../graphql/me';
import { setCsrfToken } from '@/lib/csrf';

export default function BetaTesterWaitlist() {
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  const clearError = () => { if (error) setError(null); };

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required';
    if (name.trim().length > 255) return 'Name is too long';
    if (!email.trim()) return 'Email is required';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Please enter a valid email address';

    if (!password) return 'Password is required';
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (password !== confirmPassword) return 'Passwords do not match';

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
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          password,
          ...(ref ? { ref } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'ACCOUNT_EXISTS') {
          navigate('/login', { replace: true });
          return;
        }
        setError(data.message || data.error || 'Signup failed');
        return;
      }

      // Account created — auto-logged in, go to onboarding.
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken);
      }
      const { data: meData } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data: meData });
      navigate('/onboarding', { replace: true });
    } catch (err) {
      console.error('[Signup] Network error:', err);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSuccess = async (resp: CredentialResponse) => {
    const credential = resp.credential;
    if (!credential) {
      setError('Google login did not return a valid credential.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, ...(ref ? { ref } : {}) }),
      });

      if (!res.ok) {
        setError('Google signup failed. Please try again.');
        return;
      }

      const { csrfToken } = await res.json();
      if (csrfToken) {
        setCsrfToken(csrfToken);
      }

      const { data: meData } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data: meData });
      navigate('/onboarding', { replace: true });
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Form
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
      <div className="absolute inset-0 z-0 hidden md:block bg-hero-desktop bg-cover-center bg-fixed">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>
      <div className="absolute inset-0 z-0 md:hidden bg-hero-mobile bg-cover-center">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      <motion.div
        className="absolute top-6 right-6 z-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.5 }}
      >
        <a href="/login" className="text-sm text-sand hover:opacity-80 transition-opacity">
          Log In
        </a>
      </motion.div>

      <motion.div
        className="relative z-10 container px-6 max-w-xl w-full"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-center mb-8">
          <h1 className="hero-headline mb-4">Create your account</h1>
          <p className="body-large text-sand">
            Sign up to start tracking your bike maintenance.
          </p>
        </div>

        {/* Google OAuth */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15 }}
        >
          <div className="flex justify-center rounded-2xl p-4 glass-form">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google signup failed. Please try again.')}
              text="signup_with"
              shape="pill"
              size="large"
              width="320"
            />
          </div>
          <div className="flex items-center gap-4 my-4 px-2">
            <div className="flex-1 border-t border-white/20" />
            <span className="text-xs text-concrete uppercase tracking-wider">or</span>
            <div className="flex-1 border-t border-white/20" />
          </div>
        </motion.div>

        <motion.form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-2xl p-8 glass-form"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="space-y-2">
            <label className="marketing-label">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); clearError(); }}
              className="marketing-input"
              placeholder="Your name"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="marketing-label">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError(); }}
              className="marketing-input"
              placeholder="you@example.com"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="marketing-label">Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError(); }}
              className="marketing-input"
              placeholder="At least 8 characters"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="marketing-label">Confirm Password *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); clearError(); }}
              className="marketing-input"
              placeholder="Re-enter password"
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
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary text-lg px-8 py-4 w-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating account...' : 'Create Account'}
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
