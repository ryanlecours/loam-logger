import { DEFAULT_CURRENCY, isSupportedCurrency } from '@loam/shared';
import { useCurrentUser } from './useCurrentUser';

/**
 * The currency new costs are entered in: the rider's Settings pick, else
 * USD. Reads the cached `me` query, so it costs no request of its own.
 */
export function useCurrency(): string {
  const { user } = useCurrentUser();
  const picked = user?.currency;
  return isSupportedCurrency(picked) ? picked : DEFAULT_CURRENCY;
}
