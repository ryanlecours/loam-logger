import { useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { useCurrentUser } from './useCurrentUser';

/**
 * Keep Sentry's user scope in sync with the currently authenticated user.
 *
 * - When a logged-in user is loaded, tag Sentry events with their id so
 *   browser-side errors can be correlated to "who was affected".
 * - When the user logs out (ME_QUERY resolves to null), clear the scope.
 *
 * Intentionally only tags `id`. Email / name are PII we don't need in Sentry
 * to triage issues; the id is enough to cross-reference logs and DB.
 *
 * Mount this in components that wrap authenticated routes (e.g. AuthGate).
 */
export function useSentryUser(): void {
  const { user } = useCurrentUser();
  const lastAppliedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = user?.id ?? null;
    if (id === lastAppliedIdRef.current) return;
    lastAppliedIdRef.current = id;
    if (id) {
      Sentry.setUser({ id });
    } else {
      Sentry.setUser(null);
    }
  }, [user?.id]);
}
