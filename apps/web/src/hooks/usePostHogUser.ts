import { useEffect, useRef } from 'react';
import { posthog } from '@/lib/posthog';
import { useCurrentUser } from './useCurrentUser';

/**
 * Keep PostHog's identified user in sync with the current session.
 *
 * Three concerns split into three effects so each has a well-defined trigger:
 *
 *  1. Opt-out enforcement — reads `user.analyticsOptOut` from ME_QUERY and
 *     flips the SDK's opt-out flag to match. This is the ONLY place that
 *     applies the DB-backed flag to the SDK; it fires on every authenticated
 *     page load, so a user who opted out on another device is immediately
 *     enforced here on login without needing to visit Settings. Previously
 *     this lived in PrivacySettings, but that meant new devices / cleared
 *     localStorage could leak one identify() + some events before the
 *     Settings page rendered.
 *
 *  2. Identity stitching — fires identify() when id changes AND the user is
 *     not opted out. On opt-out, does NOT identify; on subsequent opt-in,
 *     fires identify (since the ref-key treats opt-out as having no identity).
 *
 *  3. Property freshness — updates person properties when they change, but
 *     only for non-opted-out users. Skipped on the render immediately after
 *     identify() since identify carries the full property snapshot.
 *
 * Mirror of useSentryUser. Mount inside AuthGate so it fires once the viewer
 * is known.
 */
export function usePostHogUser(): void {
  const { user } = useCurrentUser();
  const lastAppliedIdRef = useRef<string | null>(null);
  const justIdentifiedForIdRef = useRef<string | null>(null);

  // 1) Opt-out enforcement. Only touches the SDK once user data has loaded
  //    from ME_QUERY — avoids a race where the SDK defaults to opted-in on
  //    first render for a user who is actually opted out in the DB.
  useEffect(() => {
    if (!user) return;
    try {
      if (user.analyticsOptOut) {
        posthog.opt_out_capturing?.();
      } else {
        posthog.opt_in_capturing?.();
      }
    } catch {
      // SDK not initialized (dev / missing key) — no-op
    }
    // Deps deliberately list only the two fields the effect reads from
    // `user` — opt-out enforcement should re-run on identity change or an
    // analyticsOptOut flip, not on every unrelated user-property change
    // (name, role, etc.). Adding `user` to the deps would trigger
    // object-identity re-runs and double-call the SDK on benign re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.analyticsOptOut]);

  // 2) Identity stitching. The "effective id" is null whenever the user is
  //    opted out, so a toggle from opt-in → opt-out fires posthog.reset()
  //    (clears the identified user on the SDK); a toggle back fires a fresh
  //    identify with the current property snapshot.
  useEffect(() => {
    const id = user?.id ?? null;
    const optedOut = Boolean(user?.analyticsOptOut);
    const effectiveId = id && !optedOut ? id : null;

    if (effectiveId === lastAppliedIdRef.current) return;
    lastAppliedIdRef.current = effectiveId;

    if (effectiveId) {
      posthog.identify(effectiveId, {
        email: user?.email,
        name: user?.name,
        subscriptionTier: user?.subscriptionTier,
        isFoundingRider: user?.isFoundingRider,
        role: user?.role,
        onboardingCompleted: user?.onboardingCompleted,
      });
      justIdentifiedForIdRef.current = effectiveId;
    } else {
      posthog.reset();
      justIdentifiedForIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.analyticsOptOut]);

  // 3) Property freshness.
  useEffect(() => {
    if (!user?.id) return;
    if (user.analyticsOptOut) return;
    if (justIdentifiedForIdRef.current === user.id) {
      justIdentifiedForIdRef.current = null;
      return;
    }
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
    user?.analyticsOptOut,
    user?.email,
    user?.name,
    user?.subscriptionTier,
    user?.isFoundingRider,
    user?.role,
    user?.onboardingCompleted,
  ]);
}
