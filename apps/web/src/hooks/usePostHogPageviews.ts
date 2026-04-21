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
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      pathname: location.pathname,
    });
  }, [location.pathname, location.search, location.hash]);
}
