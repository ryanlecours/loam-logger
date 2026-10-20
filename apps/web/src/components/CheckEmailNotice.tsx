import { useState } from 'react';
import { Button } from '@/components/ui';
import { resendVerificationEmail } from '@/lib/emailVerification';
import { useEmailSignInPoll, type EmailSignedIn } from '../hooks/useEmailSignInPoll';

type Props = {
  email: string;
  /** Called when the rider wants to go back and sign in. */
  onBackToSignIn?: () => void;
  /**
   * Called once the address is verified and this browser has signed itself
   * in with its sign-in grant. While set, the notice keeps asking.
   */
  onSignedIn?: (result: EmailSignedIn) => void;
};

/**
 * Shown after a password signup, and when signing in to an account that has
 * not confirmed its email yet. The account cannot sign in until the link in
 * the verification email is opened; with `onSignedIn`, this browser then
 * signs in by itself, wherever the link was opened.
 */
export default function CheckEmailNotice({ email, onBackToSignIn, onSignedIn }: Props) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const waitsForSignIn = Boolean(onSignedIn);

  useEmailSignInPoll(waitsForSignIn, (result) => onSignedIn?.(result));

  async function handleResend() {
    setStatus('sending');
    setError(null);
    const result = await resendVerificationEmail(email);
    if (result.ok) {
      setStatus('sent');
    } else {
      setStatus('idle');
      setError(result.error);
    }
  }

  return (
    <div className="space-y-4" role="status">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--cream)' }}>
          Check your email
        </h2>
        <p className="text-sm" style={{ color: 'var(--concrete)' }}>
          We sent a link to <strong style={{ color: 'var(--sand)' }}>{email}</strong>.{' '}
          {waitsForSignIn
            ? 'Open it on any device to confirm your address, and this page signs you in.'
            : 'Open it to confirm your address, then sign in.'}
        </p>
      </div>

      {status === 'sent' && (
        <div className="alert alert-success">
          <p>A new link is on its way. It can take a minute, and it may land in spam.</p>
        </div>
      )}
      {error && (
        <div className="alert alert-danger">
          <p>{error}</p>
        </div>
      )}

      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center text-base"
          onClick={handleResend}
          disabled={status === 'sending'}
        >
          {status === 'sending' ? 'Sending...' : 'Send a new link'}
        </Button>
        {onBackToSignIn && (
          <Button
            type="button"
            variant="primary"
            className="w-full justify-center text-base"
            onClick={onBackToSignIn}
          >
            Back to Sign In
          </Button>
        )}
      </div>
    </div>
  );
}
