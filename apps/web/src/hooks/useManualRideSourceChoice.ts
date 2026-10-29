import { useCallback, useEffect, useState } from 'react';
import { posthog } from '@/lib/posthog';
import { manualRideSourceKey } from '../utils/rideSourceState';

/**
 * The rider's "I don't use a ride tracker" choice.
 *
 * Stored per account in this browser rather than on the server: a user column
 * would mean a Prisma migration through staging for a preference that only
 * decides whether one card keeps asking, and the choice is cheap to make again
 * on another device. Connecting a provider later overrides it (see
 * resolveRideSourceState), so a stale "no" never hides a real source.
 *
 * Reads lazily and writes defensively: localStorage can be unavailable in
 * private windows, and the card must still render without it.
 */
export function useManualRideSourceChoice(userId: string | undefined): [boolean, (manualOnly: boolean) => void] {
  const [manualOnly, setManualOnlyState] = useState(false);

  useEffect(() => {
    if (!userId) {
      setManualOnlyState(false);
      return;
    }
    try {
      setManualOnlyState(localStorage.getItem(manualRideSourceKey(userId)) === '1');
    } catch {
      setManualOnlyState(false);
    }
  }, [userId]);

  const setManualOnly = useCallback(
    (next: boolean) => {
      setManualOnlyState(next);
      if (!userId) return;
      try {
        if (next) localStorage.setItem(manualRideSourceKey(userId), '1');
        else localStorage.removeItem(manualRideSourceKey(userId));
      } catch {
        // Storage unavailable: the choice holds for this page only.
      }
      // The connect funnel (phase 0) counts riders who never connect; this
      // tells it which of them said so on purpose.
      posthog.capture(next ? 'ride_source_opted_out' : 'ride_source_opt_out_cleared', { surface: 'dashboard' });
    },
    [userId]
  );

  return [manualOnly, setManualOnly];
}
