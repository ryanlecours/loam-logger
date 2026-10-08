import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { getAuthHeaders } from '@/lib/csrf';
import { EMAIL_VERIFICATION_STATUS } from '../graphql/emailVerification';

type SendState = 'idle' | 'sending' | 'sent' | 'error';

export default function EmailVerificationBanner() {
  const { data } = useQuery(EMAIL_VERIFICATION_STATUS, { errorPolicy: 'all' });
  const [sendState, setSendState] = useState<SendState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const me = data?.me as { email: string; needsEmailVerification?: boolean } | null | undefined;
  if (!me?.needsEmailVerification) return null;

  const resend = async () => {
    setSendState('sending');
    setMessage(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/resend-verification`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSendState('error');
        setMessage(body.error || 'Could not send the email. Please try again later.');
        return;
      }
      setSendState('sent');
    } catch {
      setSendState('error');
      setMessage('A network error occurred. Please try again.');
    }
  };

  return (
    <div className="container pt-4">
      <div className="alert-inline alert-inline-warning flex-wrap justify-between" role="status">
        <p>
          {sendState === 'sent'
            ? `Sent. Check ${me.email} for the link (and your spam folder).`
            : `Confirm your email to turn on share links. We sent a link to ${me.email}.`}
          {message && <span className="block mt-1">{message}</span>}
        </p>
        {sendState !== 'sent' && (
          <button
            type="button"
            onClick={resend}
            disabled={sendState === 'sending'}
            className="underline font-medium disabled:opacity-50"
          >
            {sendState === 'sending' ? 'Sending...' : 'Resend email'}
          </button>
        )}
      </div>
    </div>
  );
}
