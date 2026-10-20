import { useCallback, useEffect, useRef, useState } from 'react';

// Longest a submit waits for a token the widget is still producing (a fast
// submit, or a challenge the visitor has not clicked yet). After that the
// form goes without one, and the API records it as missing.
export const TURNSTILE_WAIT_MS = 8000;

interface Waiter {
  resolve: (token: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Holds the latest Turnstile token for a form and lets a submit wait for one
 * that is still being solved. Wire `onToken` and `onUnavailable` to
 * TurnstileWidget, then `await waitForToken()` before sending.
 */
export function useTurnstileToken(enabled: boolean, waitMs: number = TURNSTILE_WAIT_MS) {
  const tokenRef = useRef<string | null>(null);
  const unavailableRef = useRef(false);
  const waitersRef = useRef<Waiter[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);

  const settle = useCallback((waiter: Waiter, token: string | null) => {
    clearTimeout(waiter.timer);
    waitersRef.current = waitersRef.current.filter((w) => w !== waiter);
    if (waitersRef.current.length === 0) setIsWaiting(false);
    waiter.resolve(token);
  }, []);

  const settleAll = useCallback(
    (token: string | null) => {
      [...waitersRef.current].forEach((waiter) => settle(waiter, token));
    },
    [settle]
  );

  const onToken = useCallback(
    (token: string | null) => {
      tokenRef.current = token;
      if (token) settleAll(token);
    },
    [settleAll]
  );

  // The script was blocked or failed: nothing will arrive, so stop waiting.
  const onUnavailable = useCallback(() => {
    unavailableRef.current = true;
    settleAll(null);
  }, [settleAll]);

  const waitForToken = useCallback((): Promise<string | null> => {
    if (!enabled || unavailableRef.current || tokenRef.current) return Promise.resolve(tokenRef.current);
    setIsWaiting(true);
    return new Promise((resolve) => {
      const waiter: Waiter = { resolve, timer: setTimeout(() => settle(waiter, null), waitMs) };
      waitersRef.current.push(waiter);
    });
  }, [enabled, waitMs, settle]);

  // Leaving the page settles any pending wait and clears its timer.
  useEffect(
    () => () => {
      waitersRef.current.forEach((waiter) => {
        clearTimeout(waiter.timer);
        waiter.resolve(null);
      });
      waitersRef.current = [];
    },
    []
  );

  return { onToken, onUnavailable, waitForToken, isWaiting };
}
