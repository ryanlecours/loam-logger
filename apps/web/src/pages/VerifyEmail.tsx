import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { Button } from '@/components/ui';
import {
  completeEmailSignIn,
  resendVerificationEmail,
  verifyEmailToken,
  type VerifyEmailResult,
} from '@/lib/emailVerification';
import { useFinishEmailSignIn } from '../hooks/useFinishEmailSignIn';

type Status = 'verifying' | 'signing-in' | VerifyEmailResult;

const COPY: Record<Status, { title: string; body: string }> = {
  verifying: { title: 'Confirming your email', body: 'One moment.' },
  'signing-in': { title: 'Email confirmed', body: 'Signing you in.' },
  verified: {
    title: 'Email confirmed',
    body: 'You can sign in now. If you signed up in the Loam Logger app, open it and it signs you in.',
  },
  expired: {
    title: 'Link expired',
    body: 'This link has expired. Enter your email and we will send a new one.',
  },
  invalid: {
    title: 'Link not valid',
    body: 'This link has already been replaced or is not valid. Enter your email and we will send a new one.',
  },
  error: {
    title: 'Something went wrong',
    body: 'We could not confirm your email. Check your connection and try again.',
  },
};

const APP_HANDOFF_WAIT_MS = 1500;

function isPhone(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Try to open the app's verify screen, for browsers that skip universal links
 * and app links (in-app browsers, mostly), the way the reset page does. A
 * hidden iframe keeps a failed scheme from navigating this page anywhere.
 * Resolves when this page should verify itself after all: after a moment if
 * the app did not open, or once the rider comes back here if it did (an app
 * build without the verify screen would otherwise leave the email unverified).
 * Verifying twice is harmless: the second answer is "already verified".
 */
function handOffToApp(token: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = `loamlogger://verify-email?token=${encodeURIComponent(token)}`;
    document.body.appendChild(iframe);

    let appOpened = false;
    const finish = () => {
      iframe.remove();
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
      resolve();
    };
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        appOpened = true;
        clearTimeout(timer);
      } else if (appOpened) {
        finish();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setTimeout(() => {
      if (!appOpened) finish();
    }, APP_HANDOFF_WAIT_MS);
  });
}

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const finishEmailSignIn = useFinishEmailSignIn();
  // Read once and kept in state, so the token can be dropped from the URL
  // (below) while Try Again still has it.
  const [token] = useState(() => searchParams.get('token'));
  // Only a tap on the emailed link tries the app: a typed or bookmarked URL
  // should never raise an "Open in app?" prompt.
  const [tryApp] = useState(() => searchParams.get('source') === 'email' && isPhone());

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'invalid');
  // The verified address, for prefilling sign-in when this browser cannot sign in by itself.
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  // A token works once. StrictMode runs effects twice in development, and a
  // second request would land on an already-used token.
  const submitted = useRef(false);

  async function runVerify(t: string) {
    setStatus('verifying');
    const outcome = await verifyEmailToken(t);
    if (outcome.email) setVerifiedEmail(outcome.email);
    if (outcome.status !== 'verified') {
      setStatus(outcome.status);
      return;
    }

    // The link only verifies. If this browser signed up (or tried to sign
    // in) for this same address, it holds a sign-in grant and goes straight in.
    if (!outcome.email) {
      setStatus('verified');
      return;
    }
    setStatus('signing-in');
    const signIn = await completeEmailSignIn(outcome.email);
    if (signIn.status === 'signed-in') {
      await finishEmailSignIn(signIn);
      return;
    }
    setStatus('verified');
  }

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;
    // Keep the token out of browser history and out of the URL any later
    // navigation from this page would carry.
    setSearchParams({}, { replace: true });
    void (async () => {
      if (tryApp) await handOffToApp(token);
      await runVerify(token);
    })();
    // runVerify only sets state; listing it would rerun this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tryApp, setSearchParams]);

  function goToSignIn() {
    navigate(verifiedEmail ? `/login?email=${encodeURIComponent(verifiedEmail)}` : '/login', { replace: true });
  }

  async function handleResend(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setResendState('sending');
    setResendError(null);
    const result = await resendVerificationEmail(email.trim());
    if (result.ok) {
      setResendState('sent');
    } else {
      setResendState('idle');
      setResendError(result.error);
    }
  }

  const copy = COPY[status];
  const needsNewLink = status === 'expired' || status === 'invalid';

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
      <div className="absolute inset-0 z-0 hidden md:block bg-hero-desktop bg-cover-center bg-fixed">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>
      <div className="absolute inset-0 z-0 md:hidden bg-hero-mobile bg-cover-center">
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
          <div className="text-center space-y-1" role="status" aria-live="polite">
            <p className="text-xs uppercase tracking-[0.4em]" style={{ color: 'var(--sage)' }}>
              Loam Logger
            </p>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--cream)' }}>
              {copy.title}
            </h1>
            <p className="text-sm" style={{ color: 'var(--concrete)' }}>
              {copy.body}
            </p>
          </div>

          {(status === 'verifying' || status === 'signing-in') && (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}

          {status === 'verified' && (
            <Button
              type="button"
              variant="primary"
              className="w-full justify-center text-base"
              onClick={goToSignIn}
            >
              Go to Sign In
            </Button>
          )}

          {status === 'error' && token && (
            <Button
              type="button"
              variant="primary"
              className="w-full justify-center text-base"
              onClick={() => void runVerify(token)}
            >
              Try Again
            </Button>
          )}

          {needsNewLink && (
            <form
              className="space-y-4 p-4 rounded-xl"
              style={{ backgroundColor: 'rgba(54, 60, 57, 0.3)' }}
              onSubmit={handleResend}
            >
              {resendState === 'sent' && (
                <div className="alert alert-success">
                  <p>If that address is waiting on confirmation, a new link is on its way.</p>
                </div>
              )}
              {resendError && (
                <div className="alert alert-danger">
                  <p>{resendError}</p>
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
                  disabled={resendState === 'sending'}
                  required
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                className="w-full justify-center text-base"
                disabled={resendState === 'sending'}
              >
                {resendState === 'sending' ? 'Sending...' : 'Send a New Link'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-center text-base"
                onClick={() => navigate('/login', { replace: true })}
              >
                Back to Sign In
              </Button>
            </form>
          )}
        </div>
      </motion.div>
    </section>
  );
}
