import { useState } from 'react';
import { gql, useMutation } from '@apollo/client';
import { useCurrentUser } from '../hooks/useCurrentUser';

// Mutation returns { id, analyticsOptOut }, which Apollo normalizes into the
// cached User entry keyed by id — so the `me` query's cached data updates
// automatically. No manual refetch needed.
const UPDATE_ANALYTICS_OPT_OUT = gql`
  mutation UpdateAnalyticsOptOut($optOut: Boolean!) {
    updateAnalyticsOptOut(optOut: $optOut) {
      id
      analyticsOptOut
    }
  }
`;

/**
 * Self-serve analytics opt-out toggle.
 *
 * Source of truth is `User.analyticsOptOut` in the DB:
 *  - On the client, we call `posthog.opt_out_capturing()` to immediately
 *    stop all browser-SDK events (pageview, autocapture, replay, identify).
 *  - On the server, `captureServerEvent` short-circuits for users whose
 *    `analyticsOptOut` is true, so GraphQL/webhook/worker events are also
 *    suppressed.
 *
 * Unlike a purely client-side localStorage toggle, the server-backed flag
 * survives browser changes, new devices, and cache clears — matching the
 * GDPR Article 7(3) requirement that withdrawal of consent stops processing
 * system-wide, not just on one device.
 */
export default function PrivacySettings() {
  const { user } = useCurrentUser();
  const [updateOptOut, { loading }] = useMutation(UPDATE_ANALYTICS_OPT_OUT);
  const [error, setError] = useState<string | null>(null);

  const optedOut = Boolean(user?.analyticsOptOut);

  // SDK-level opt_out_capturing / opt_in_capturing is applied by
  // usePostHogUser (mounted in AuthGate), which reads the same
  // `user.analyticsOptOut` from ME_QUERY. When the mutation below resolves,
  // Apollo's normalized cache updates the user entry, which re-runs that
  // effect and flips the SDK state. Nothing extra needed here.

  const handleToggle = async () => {
    setError(null);
    try {
      await updateOptOut({ variables: { optOut: !optedOut } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update preference');
    }
  };

  if (!user) return null;

  return (
    <section className="panel-spaced">
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
          checked={!optedOut}
          onChange={handleToggle}
          disabled={loading}
          className="mt-1 w-5 h-5 rounded border-app bg-surface accent-accent flex-shrink-0 disabled:opacity-50"
        />
        <span className="text-sm leading-relaxed text-primary">
          Share product analytics and session recordings to help improve Loam
          Logger. This applies everywhere you're signed in — uncheck to
          suppress both browser activity and server-side events tied to your
          account.
        </span>
      </label>

      {optedOut && !loading && (
        <p className="text-xs text-success">
          ✓ Analytics disabled. No events, recordings, or identifying data are
          being sent to PostHog for your account.
        </p>
      )}
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
    </section>
  );
}
