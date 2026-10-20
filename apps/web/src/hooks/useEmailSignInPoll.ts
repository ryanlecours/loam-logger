import { useEffect, useRef } from 'react';
import {
  completeEmailSignIn,
  emailSignInPollDelay,
  type EmailSignInResult,
} from '@/lib/emailVerification';

export type EmailSignedIn = Extract<EmailSignInResult, { status: 'signed-in' }>;

/**
 * While `enabled`, keep asking whether this browser's sign-in grant can sign
 * in yet, so opening the verification link anywhere (another tab, the phone)
 * signs this tab in. Asks only while the tab is visible, and straight away
 * when it becomes visible again, which is when a rider comes back after
 * opening the email. Stops for good once signed in, once the API says this
 * browser holds no usable grant, or when the grant would have expired.
 */
export function useEmailSignInPoll(enabled: boolean, onSignedIn: (result: EmailSignedIn) => void): void {
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  useEffect(() => {
    if (!enabled) return;

    const startedAt = Date.now();
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    const schedule = (minDelayMs = 0) => {
      if (stopped) return;
      const delay = emailSignInPollDelay(Date.now() - startedAt);
      if (delay === null) {
        stop();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), Math.max(delay, minDelayMs));
    };

    const poll = async () => {
      timer = null;
      // A hidden tab waits for visibilitychange instead of polling.
      if (stopped || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const result = await completeEmailSignIn();
      inFlight = false;
      if (stopped) return;

      if (result.status === 'signed-in') {
        stop();
        onSignedInRef.current(result);
      } else if (result.status === 'unavailable') {
        stop();
      } else {
        schedule(result.status === 'retry' ? result.retryAfterMs : 0);
      }
    };

    function onVisibility() {
      if (document.visibilityState !== 'visible' || stopped) return;
      if (timer) clearTimeout(timer);
      void poll();
    }

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return stop;
  }, [enabled]);
}
