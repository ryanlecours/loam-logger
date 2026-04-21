import { useEffect, useRef } from 'react';
import { posthog } from '@/lib/posthog';
import { useCurrentUser } from './useCurrentUser';

/**
 * Keep PostHog's identified user in sync with the current session.
 *
 * Two concerns split into two effects:
 *
 *  1. Identity stitching — fires ONLY when id changes (login/logout).
 *     `identify()` with the full property snapshot runs once per login;
 *     PostHog merges prior anonymous activity into the real user.
 *
 *  2. Property freshness — fires when any tracked property changes
 *     (subscriptionTier after upgrade, onboardingCompleted after finish,
 *     etc.). Uses `setPersonProperties` so we update the person record
 *     without re-stitching identity on every ME_QUERY revalidation.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    posthog.setPersonProperties({
      email: user.email,
      name: user.name,
      subscriptionTier: user.subscriptionTier,
      isFoundingRider: user.isFoundingRider,
      role: user.role,
      onboardingCompleted: user.onboardingCompleted,
    });
  }, [
    user?.id,
    user?.email,
    user?.name,
    user?.subscriptionTier,
    user?.isFoundingRider,
    user?.role,
    user?.onboardingCompleted,
  ]);
}
