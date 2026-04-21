import { useEffect, useState } from 'react';
import { posthog } from '../lib/posthog';

/**
 * Self-serve analytics opt-out toggle.
 *
 * Calls into posthog-js's built-in opt-out API, which persists the choice to
 * localStorage under its own key. Once opted out, the SDK no-ops all
 * captures (pageview, autocapture, session replay, identify, feature flags)
 * until opt-in is called again. This satisfies the GDPR / ePrivacy
 * requirement for a self-serve mechanism that doesn't route through
 * support email.
 *
 * Note: this only controls the browser SDK. Server-side events from the API
 * (triggered by GraphQL mutations, webhooks, workers) are not yet gated on a
 * per-user opt-out — that requires an `analyticsOptOut` column on User and
 * threading it through captureServerEvent. Tracked as a follow-up.
 */
export default function PrivacySettings() {
  const [optedOut, setOptedOut] = useState<boolean | null>(null);

  // On mount, read current opt-out state from the SDK. Gracefully degrade
  // when PostHog isn't initialized (dev mode, missing key) — the API still
  // exists as a no-op but may return undefined.
  useEffect(() => {
    try {
      const state = posthog.has_opted_out_capturing?.();
      setOptedOut(Boolean(state));
    } catch {
      setOptedOut(false);
    }
  }, []);

  const handleToggle = () => {
    if (optedOut) {
      posthog.opt_in_capturing?.();
      setOptedOut(false);
    } else {
      posthog.opt_out_capturing?.();
      setOptedOut(true);
    }
  };

  if (optedOut === null) return null; // first paint, avoid flicker

  return (
    <section className="panel-spaced xl:max-w-[calc(50%-0.75rem)]">
      <div>
        <p className="label-section">Privacy</p>
        <h2 className="title-section">Product Analytics</h2>
      </div>
      <p className="text-sm text-muted">
        We use PostHog to understand how people use Loam Logger and where they
        get stuck, so we can improve the product. This includes pageviews,
        clicks, a small sample of session recordings (with form inputs masked),
        and your email and subscription tier for account correlation. See the{' '}
        <a
          href="/privacy"
          className="text-mint hover:text-sage transition-colors underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          privacy policy
        </a>{' '}
        for the full list.
      </p>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={optedOut}
          onChange={handleToggle}
          className="mt-1 w-5 h-5 rounded border-app bg-surface accent-accent flex-shrink-0"
        />
        <span className="text-sm leading-relaxed text-primary">
          Opt out of product analytics and session recording on this device.
          The opt-out is stored in your browser — if you clear site data or use
          another device, you'll need to opt out again there.
        </span>
      </label>

      {optedOut && (
        <p className="text-xs text-success">
          ✓ Analytics disabled. No events, recordings, or identifying data will
          leave this browser for PostHog.
        </p>
      )}
    </section>
  );
}
