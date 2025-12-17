import { useState, useEffect } from 'react';
import { useApolloClient } from '@apollo/client';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ME_QUERY } from '../graphql/me';
import { useRedirectFrom } from '../utils/loginUtils';
import { Button } from '@/components/ui';
import '../styles/marketing.css';

export default function Login() {
  const apollo = useApolloClient();
  const navigate = useNavigate();
  const from = useRedirectFrom();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('marketing-page');
    document.documentElement.style.scrollBehavior = 'smooth';

    return () => {
      document.documentElement.classList.remove('marketing-page');
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  async function handleLoginSuccess(resp: CredentialResponse) {
    const credential = resp.credential;
    if (!credential) {
      console.error('[GoogleLogin] Missing credential in response', resp);
      alert('Google login did not return a valid credential.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('[GoogleLogin] Backend responded with error', res.status, text);

        if (text.trim() === 'NOT_BETA_TESTER') {
          navigate('/beta-waitlist', { replace: true });
          return;
        }

        alert(`Login failed: ${res.statusText}`);
        return;
      }

      const { data } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data });
      navigate(from, { replace: true });
    } catch (err) {
      console.error('[GoogleLogin] Network or unexpected error', err);
      alert('A network error occurred during login. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleLoginError() {
    console.error('[GoogleLogin] Google login widget reported error');
    alert('Google login failed. Please try again.');
  }

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    // Validate password confirmation for signup
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const endpoint = mode === 'login' ? 'login' : 'signup';
      const body = mode === 'signup'
        ? { email, password, name }
        : { email, password };

      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const text = await res.text();

      if (!res.ok) {
        console.error(`[${mode}] Backend responded with error`, res.status, text);

        // Handle specific errors
        if (text.trim() === 'NOT_BETA_TESTER') {
          navigate('/beta-waitlist', { replace: true });
          return;
        }

        // Map backend error messages to user-friendly messages
        const errorMap: Record<string, string> = {
          'Email already in use': 'This email is already registered. Try logging in instead.',
          'Invalid email or password': mode === 'signup' ? 'Invalid email format.' : 'Invalid email or password.',
          'Invalid email format': 'Please enter a valid email address.',
          'Name is required': 'Please enter your name.',
          'Password must be at least 8 characters': 'Password must be at least 8 characters.',
          'Password must contain at least one uppercase letter': 'Password must contain an uppercase letter.',
          'Password must contain at least one lowercase letter': 'Password must contain a lowercase letter.',
          'Password must contain at least one number': 'Password must contain a number.',
          'Password must contain at least one special character (!@#$%^&*)':
            'Password must contain a special character (!@#$%^&*).',
          'This account uses OAuth login only': 'This email is registered with OAuth. Log in with Google instead.',
        };

        const userMessage = errorMap[text.trim()] || text || `${mode === 'signup' ? 'Signup' : 'Login'} failed`;
        setError(userMessage);
        return;
      }

      // Success - refetch user and navigate
      const { data } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data });
      navigate(from, { replace: true });
    } catch (err) {
      console.error(`[${mode}] Network or unexpected error`, err);
      setError('A network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden mkt-bg-dark">
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

      {/* Back to Home Link */}
      <motion.div
        className="absolute top-6 right-6 z-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.5 }}
      >
        <a
          href="/"
          className="text-sm hover:opacity-80 transition-opacity"
          style={{ color: 'var(--mkt-sand)' }}
        >
          ← Back to Home
        </a>
      </motion.div>

      {/* Login Form Content */}
      <motion.div
        className="relative z-10 mkt-container px-6 max-w-md w-full"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="w-full rounded-2xl p-8 space-y-6" style={{
          backgroundColor: 'var(--mkt-glass)',
          border: '1px solid var(--mkt-slate)',
          backdropFilter: 'blur(12px)',
        }}>
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-[0.4em]" style={{ color: 'var(--mkt-sage)' }}>Loam Logger</p>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--mkt-cream)' }}>Track your rides, maintain your bike</h1>
          <p className="text-sm" style={{ color: 'var(--mkt-concrete)' }}>Sign in to sync rides, gear hours, and service logs.</p>
        </div>

        <div className="flex rounded-full border border-app p-1">
          <button
            type="button"
            disabled={isLoading}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
              mode === 'login' ? 'btn-primary' : 'btn-outline text-accent-contrast hover:text-white hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1'
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={() => {
              setMode('login');
              setConfirmPassword('');
              setName('');
              setError(null);
            }}
          >
            Login
          </button>
          <button
            type="button"
            disabled={isLoading}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
              mode === 'signup' ? 'btn-primary' : 'btn-outline hover:text-white hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1'
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={() => {
              setMode('signup');
              setConfirmPassword('');
              setName('');
              setError(null);
            }}
          >
            Sign Up
          </button>
        </div>

        <form className="space-y-4 p-4 rounded-xl" style={{ backgroundColor: 'rgba(54, 60, 57, 0.3)' }} onSubmit={handleManualSubmit}>
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          {mode === 'signup' && (
            <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--mkt-concrete)' }}>
              Name
              <input
                type="text"
                className="mt-1 w-full input-soft"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
                disabled={isLoading}
                required
              />
            </label>
          )}
          <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--mkt-concrete)' }}>
            Email
            <input
              type="email"
              className="mt-1 w-full input-soft"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isLoading}
              required
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--mkt-concrete)' }}>
            Password
            <input
              type="password"
              className="mt-1 w-full input-soft"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              disabled={isLoading}
              required
            />
          </label>
          {mode === 'signup' && (
            <label className="block text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--mkt-concrete)' }}>
              Confirm Password
              <input
                type="password"
                className="mt-1 w-full input-soft"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                required
              />
            </label>
          )}
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
            {isLoading ? 'Loading...' : mode === 'login' ? 'Login' : 'Create Account'}
          </Button>
        </form>

        <div className={`space-y-3 p-4 rounded-xl ${isLoading ? 'opacity-50 pointer-events-none' : ''}`} style={{ backgroundColor: 'rgba(54, 60, 57, 0.3)' }}>
          <div className="text-center text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--mkt-concrete)' }}>Or continue with</div>
          <div className="flex flex-col gap-3">
            <div className="flex justify-center">
              <GoogleLogin
                useOneTap
                onSuccess={handleLoginSuccess}
                onError={handleLoginError}
                shape="pill"
                theme="filled_black"
                size="large"
                width="260"
              />
            </div>
          </div>
        </div>

        </div>
      </motion.div>
    </section>
  );
}
