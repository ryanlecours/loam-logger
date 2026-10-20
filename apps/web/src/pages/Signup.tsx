import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useApolloClient } from '@apollo/client';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { ME_QUERY } from '../graphql/me';
import { setCsrfToken } from '@/lib/csrf';
import { readPendingProviderLink, type PendingProviderLink } from '@/lib/providerLink';
import ProviderLinkModal from '../components/ProviderLinkModal';
import CheckEmailNotice from '../components/CheckEmailNotice';
import TurnstileWidget, { type TurnstileHandle } from '../components/TurnstileWidget';

// Longest a submit waits for a token the widget is still producing (a fast
// submit, or a challenge the visitor has not clicked yet). After that the
// signup goes without one, and the API records it as missing.
const TURNSTILE_WAIT_MS = 8000;

export default function Signup() {
  // Unset in environments without a Turnstile widget; signup then sends no token.
  const turnstileSiteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;
  const turnstileRef = useRef<TurnstileHandle>(null);
  const turnstileTokenRef = useRef<string | null>(null);
  const turnstileUnavailableRef = useRef(false);
  const tokenWaitersRef = useRef<Array<(token: string | null) => void>>([]);
  const [isVerifying, setIsVerifying] = useState(false);

  const releaseTokenWaiters = (token: string | null) => {
    tokenWaitersRef.current.splice(0).forEach((resolve) => resolve(token));
  };

  const handleTurnstileToken = useCallback((token: string | null) => {
    turnstileTokenRef.current = token;
    if (token) releaseTokenWaiters(token);
  }, []);

  // The script was blocked or failed: nothing will arrive, so stop waiting.
  const handleTurnstileUnavailable = useCallback(() => {
    turnstileUnavailableRef.current = true;
    releaseTokenWaiters(null);
  }, []);

  const waitForTurnstileToken = (): Promise<string | null> => {
    if (!turnstileSiteKey || turnstileUnavailableRef.current || turnstileTokenRef.current) {
      return Promise.resolve(turnstileTokenRef.current);
    }
    setIsVerifying(true);
    return new Promise((resolve) => {
      const done = (token: string | null) => {
        clearTimeout(timer);
        tokenWaitersRef.current = tokenWaitersRef.current.filter((waiter) => waiter !== done);
        resolve(token);
      };
      const timer = setTimeout(() => done(null), TURNSTILE_WAIT_MS);
      tokenWaitersRef.current.push(done);
    });
  };

  const navigate = useNavigate();
  const apollo = useApolloClient();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingLink, setPendingLink] = useState<PendingProviderLink | null>(null);
  // Set once a password signup succeeds: the account exists but cannot sign
  // in until the address is confirmed.
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  const [emailTaken, setEmailTaken] = useState(false);

  const clearError = () => {
    if (error) setError(null);
    if (emailTaken) setEmailTaken(false);
  };

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
      const turnstileToken = await waitForTurnstileToken();
      setIsVerifying(false);

      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          password,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Some refusals (429, 5xx) come after the API spent the single-use
        // token. Re-solving after every refusal is simpler than telling them
        // apart, and costs the visitor nothing.
        turnstileRef.current?.reset();
        if (data.code === 'EMAIL_EXISTS') {
          // Also the way back for anyone whose address someone else signed
          // up with: a reset goes to the inbox and replaces that password.
          setEmailTaken(true);
          setError('An account with this email already exists. Log in, or reset your password if you have forgotten it.');
          return;
        }
        setError(data.message || data.error || 'Signup failed');
        return;
      }

      // Account created. No session until the emailed link is opened.
      setVerificationEmail(data.email || email.trim());
    } catch (err) {
      console.error('[Signup] Network error:', err);
      turnstileRef.current?.reset();
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsVerifying(false);
      setIsSubmitting(false);
    }
  };

  const finishGoogleSignIn = async (csrfToken: string | undefined) => {
    if (csrfToken) {
      setCsrfToken(csrfToken);
    }
    const { data: meData } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
    apollo.writeQuery({ query: ME_QUERY, data: meData });
    navigate('/onboarding', { replace: true });
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
        body: JSON.stringify({ credential }),
      });

      if (!res.ok) {
        const pending = await readPendingProviderLink(res);
        if (pending) {
          setPendingLink(pending);
          return;
        }
        setError('Google signup failed. Please try again.');
        return;
      }

      const { csrfToken } = await res.json();
      await finishGoogleSignIn(csrfToken);
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Form
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
      <ProviderLinkModal
        pending={pendingLink}
        onClose={() => setPendingLink(null)}
        onLinked={(csrfToken) => {
          setPendingLink(null);
          finishGoogleSignIn(csrfToken).catch((err) => {
            console.error('[Signup] Failed after linking', err);
            setError('Signed in, but the page could not load. Please refresh.');
          });
        }}
      />
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
        {verificationEmail ? (
          <div className="rounded-2xl p-8 glass-form">
            <CheckEmailNotice
              email={verificationEmail}
              onBackToSignIn={() => navigate('/login', { replace: true })}
            />
          </div>
        ) : (
        <>
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
              {emailTaken && (
                <p className="text-sm mt-2 flex gap-4">
                  <a href="/login" className="underline hover:opacity-80">Log in</a>
                  <a href="/forgot-password" className="underline hover:opacity-80">Reset password</a>
                </p>
              )}
            </motion.div>
          )}

          <div>
            {turnstileSiteKey && (
              <TurnstileWidget
                ref={turnstileRef}
                siteKey={turnstileSiteKey}
                action="signup"
                onToken={handleTurnstileToken}
                onUnavailable={handleTurnstileUnavailable}
              />
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary text-lg px-8 py-4 w-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVerifying ? 'Verifying...' : isSubmitting ? 'Creating account...' : 'Create Account'}
            </button>
          </div>
        </motion.form>
        </>
        )}

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
