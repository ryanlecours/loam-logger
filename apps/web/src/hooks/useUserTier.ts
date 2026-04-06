import { useViewer } from '../graphql/me';

export type SubscriptionTier = 'FREE_LIGHT' | 'FREE_FULL' | 'PRO';

export function useUserTier() {
  const { viewer, loading, error } = useViewer();

  const role = viewer?.role as string | undefined;
  const isAdmin = role === 'ADMIN';
  const isFoundingRider = viewer?.isFoundingRider ?? false;

  const tier = (viewer?.subscriptionTier ?? 'FREE_LIGHT') as SubscriptionTier;
  const isPro = tier === 'PRO' || isAdmin || isFoundingRider;
  const isFree = (tier === 'FREE_LIGHT' || tier === 'FREE_FULL') && !isAdmin && !isFoundingRider;
  const isFreeLight = tier === 'FREE_LIGHT' && !isFoundingRider && !isAdmin;
  const isFreeFull = tier === 'FREE_FULL' && !isFoundingRider && !isAdmin;

  const tierLimits = viewer?.tierLimits ?? null;
  const canAddBike = tierLimits?.canAddBike ?? true;
  const allowedComponentTypes = tierLimits?.allowedComponentTypes ?? [];
  const needsDowngradeSelection = viewer?.needsDowngradeSelection ?? false;
  const referralCode = viewer?.referralCode ?? null;

  return {
    tier,
    role,
    isAdmin,
    isPro,
    isFree,
    isFreeLight,
    isFreeFull,
    isFoundingRider,
    canAddBike,
    allowedComponentTypes,
    needsDowngradeSelection,
    referralCode,
    tierLimits,
    loading,
    error,
  };
}
