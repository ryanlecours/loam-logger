import { useEffect, useState } from 'react';
import { posthog } from '@/lib/posthog';

/**
 * PostHog feature flag that switches the service outage banner on. It is
 * deliberately not served by our own API: the banner exists for the moments
 * when that API is down. Toggle it in PostHog (Feature flags, "ops" tag); no
 * deploy involved. See docs/outage-banner.md for the runbook.
 */
export const OUTAGE_FLAG_KEY = 'service-outage-banner';

export const DEFAULT_OUTAGE_MESSAGE =
  'Loam Logger is experiencing a service outage. I am aware of the issue and working on restoring functionality as quickly as possible.';

export interface OutageNotice {
  message: string;
}

/**
 * Turn a flag evaluation into a notice, or null when the flag is off. The
 * payload may be `{ message }`, a bare string, or missing; blank copy falls
 * back to the default so an empty payload never renders an empty strip.
 */
export function readOutageNotice(enabled: boolean | undefined, payload: unknown): OutageNotice | null {
  if (!enabled) return null;
  const raw =
    typeof payload === 'string'
      ? payload
      : payload && typeof payload === 'object'
        ? (payload as { message?: unknown }).message
        : undefined;
  const message = typeof raw === 'string' ? raw.trim() : '';
  return { message: message || DEFAULT_OUTAGE_MESSAGE };
}

/**
 * The current outage notice, or null. Null until PostHog has loaded flags,
 * and always null where PostHog is not initialized (dev, missing key).
 *
 * Flags load once per page load, so a flag flipped while a tab sits open is
 * not seen until the next load. Returning to the tab asks for fresh flags, so
 * a rider who switches back after the incident sees the strip clear without
 * a reload. Opted-out riders still get the banner: posthog-js gates events
 * on consent, not the flags request.
 */
export function useOutageNotice(): OutageNotice | null {
  const [notice, setNotice] = useState<OutageNotice | null>(null);

  useEffect(() => {
    const unsubscribe = posthog.onFeatureFlags(() => {
      setNotice(
        readOutageNotice(
          posthog.isFeatureEnabled(OUTAGE_FLAG_KEY, { send_event: false }),
          posthog.getFeatureFlagPayload(OUTAGE_FLAG_KEY)
        )
      );
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') posthog.reloadFeatureFlags();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return notice;
}
