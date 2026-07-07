import { useViewer } from '../graphql/me';

export type SubscriptionTier = 'FREE' | 'PRO';

export function useUserTier() {
  const { viewer, loading, error } = useViewer();

  const role = viewer?.role as string | undefined;
  const isAdmin = role === 'ADMIN';
  const isFoundingRider = viewer?.isFoundingRider ?? false;

  const tier = (viewer?.subscriptionTier ?? 'FREE') as SubscriptionTier;
  const isPro = tier === 'PRO' || isAdmin || isFoundingRider;
  const isFree = tier !== 'PRO' && !isAdmin && !isFoundingRider;

  const tierLimits = viewer?.tierLimits ?? null;
  const canAddBike = tierLimits?.canAddBike ?? true;
  const allowedComponentTypes = tierLimits?.allowedComponentTypes ?? [];
  const needsDowngradeSelection = viewer?.needsDowngradeSelection ?? false;

  return {
    tier,
    role,
    isAdmin,
    isPro,
    isFree,
    isFoundingRider,
    canAddBike,
    allowedComponentTypes,
    needsDowngradeSelection,
    tierLimits,
    loading,
    error,
  };
}
