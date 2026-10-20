import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { loadTurnstile } from '@/lib/turnstile';

/**
 * Cloudflare Turnstile, the bot check on web password signup. Runs in
 * `interaction-only` mode: most visitors never see it, and the widget only
 * appears when Cloudflare wants a click. The token it produces goes to the API
 * with the signup, which verifies it (apps/api/src/services/turnstile.ts).
 */

export interface TurnstileHandle {
  /** Discard the current token and solve again (tokens are single-use). */
  reset(): void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** Shown in the Turnstile analytics, so each form can be told apart. */
  action?: string;
  /** A fresh token, or null when it expired, failed or was reset. */
  onToken: (token: string | null) => void;
  /** The script could not load (blocked or offline), so no token will come. */
  onUnavailable?: () => void;
  ref?: Ref<TurnstileHandle>;
}

// Below this width the 300px widget would spill out of the signup card.
const COMPACT_QUERY = '(max-width: 400px)';

export default function TurnstileWidget({ siteKey, action, onToken, onUnavailable, ref }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
    onUnavailableRef.current = onUnavailable;
  }, [onToken, onUnavailable]);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        onTokenRef.current(null);
        if (widgetIdRef.current !== undefined) window.turnstile?.reset(widgetIdRef.current);
      },
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        const compact = typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'dark',
          size: compact ? 'compact' : 'normal',
          appearance: 'interaction-only',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
          'before-interactive-callback': () => setInteractive(true),
          'after-interactive-callback': () => setInteractive(false),
        });
      })
      .catch((err) => {
        // Signup still works without a token; the API records it as missing.
        console.warn('[Turnstile] Not available:', err);
        if (!cancelled) onUnavailableRef.current?.();
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== undefined) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = undefined;
      }
    };
  }, [siteKey, action]);

  // Takes no room until Cloudflare asks for a click, then spaces itself off
  // whatever follows it.
  return (
    <div
      ref={containerRef}
      data-testid="turnstile-widget"
      className={interactive ? 'flex justify-center mb-4' : 'flex justify-center'}
    />
  );
}
