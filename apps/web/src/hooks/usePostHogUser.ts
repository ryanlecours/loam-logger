import { useEffect, useRef } from 'react';
import { posthog } from '@/lib/posthog';
import { useCurrentUser } from './useCurrentUser';

/**
 * Keep PostHog's identified user in sync with the current session.
 *
 * Identifying sets the user's id as the distinct_id for all subsequent events
 * and merges their prior anonymous activity (landing-page visits before they
 * signed up) into the same user timeline.
 *
 * Mirror of useSentryUser. Mount inside AuthGate so it fires once the viewer
 * is known.
 */
export function usePostHogUser(): void {
  const { user } = useCurrentUser();
  const lastAppliedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = user?.id ?? null;
    if (id === lastAppliedIdRef.current) return;
    lastAppliedIdRef.current = id;

    if (id) {
      posthog.identify(id, {
        email: user?.email,
        name: user?.name,
        subscriptionTier: user?.subscriptionTier,
        isFoundingRider: user?.isFoundingRider,
        role: user?.role,
        onboardingCompleted: user?.onboardingCompleted,
      });
    } else {
      posthog.reset();
    }
  }, [user?.id, user?.email, user?.name, user?.subscriptionTier, user?.isFoundingRider, user?.role, user?.onboardingCompleted]);
}
