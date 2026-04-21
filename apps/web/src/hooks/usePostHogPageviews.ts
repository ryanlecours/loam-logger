import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { posthog } from '@/lib/posthog';

/**
 * Capture a $pageview event on every React Router navigation.
 *
 * posthog-js is initialized with capture_pageview: false so SPA pushState
 * navigations aren't missed — this hook fires one event per location change
 * (including the initial mount).
 *
 * Must be rendered inside <BrowserRouter>.
 */
export function usePostHogPageviews(): void {
  const location = useLocation();
  useEffect(() => {
    // Guard against the first-render race between this hook and
    // PrivacySettings' opt-out effect: React doesn't guarantee effect
    // ordering across components, so the user's opt-out state may not yet
    // have been applied to the SDK on mount. Reading has_opted_out_capturing
    // directly from the SDK on each fire is authoritative and cheap.
    try {
      if (posthog.has_opted_out_capturing?.()) return;
    } catch {
      // SDK not initialized (dev / missing key) — proceed with the call,
      // which is itself a no-op in that state.
    }
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      pathname: location.pathname,
    });
  }, [location.pathname, location.search, location.hash]);
}
