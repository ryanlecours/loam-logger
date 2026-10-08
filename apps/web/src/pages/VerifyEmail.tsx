import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useApolloClient } from '@apollo/client';
import { motion } from 'motion/react';
import { Button } from '@/components/ui';
import { getAuthHeaders } from '@/lib/csrf';

type Status = 'verifying' | 'verified' | 'expired' | 'invalid' | 'error';

const COPY: Record<Status, { title: string; body: string }> = {
  verifying: { title: 'Confirming your email', body: 'One moment.' },
  verified: { title: 'Email confirmed', body: 'Thanks. Share links are now turned on for your account.' },
  expired: {
    title: 'Link expired',
    body: 'This link has expired or a newer one replaced it. Sign in at loamlogger.app or in the app to send a fresh link.',
  },
  invalid: {
    title: 'Link not recognized',
    body: 'This link is not valid. Check that the whole address from the email was copied, or send a fresh link once you are signed in.',
  },
  error: { title: 'Something went wrong', body: 'We could not confirm your email. Please try the link again.' },
};

export default function VerifyEmail() {
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const [searchParams] = useSearchParams();
  // Read once: the URL is cleaned below, and the token must outlive that.
  const [token] = useState(() => searchParams.get('token'));
  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'invalid');
  // StrictMode runs effects twice in development; the token is single use.
  const submitted = useRef(false);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;
    // Drop the token from the address bar so analytics pageviews, history and
    // anything that reads the URL never see it.
    navigate('/verify-email', { replace: true });

    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-email`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          setStatus('verified');
          // Clears the banner if this browser is signed in. Harmless if not.
          apollo.refetchQueries({ include: 'active' }).catch(() => {});
          return;
        }
        const data = await res.json().catch(() => ({}));
        setStatus(data.code === 'TOKEN_EXPIRED' ? 'expired' : data.code === 'TOKEN_INVALID' ? 'invalid' : 'error');
      } catch (err) {
        console.error('[VerifyEmail] Network error', err);
        setStatus('error');
      }
    })();
  }, [token, apollo, navigate]);

  const { title, body } = COPY[status];

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
          <div className="text-center space-y-1" aria-live="polite">
            <p className="text-xs uppercase tracking-[0.4em]" style={{ color: 'var(--sage)' }}>
              Loam Logger
            </p>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--cream)' }}>
              {title}
            </h1>
            <p className="text-sm" style={{ color: 'var(--concrete)' }}>
              {body}
            </p>
          </div>

          {status === 'verifying' ? (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="w-full justify-center text-base"
              onClick={() => navigate('/dashboard', { replace: true })}
            >
              Go to Loam Logger
            </Button>
          )}
        </div>
      </motion.div>
    </section>
  );
}
