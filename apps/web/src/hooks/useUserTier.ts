import { useViewer } from '../graphql/me';

export type UserRole = 'FREE' | 'PRO' | 'FOUNDING_RIDER' | 'ADMIN';

export function useUserTier() {
  const { viewer, loading, error } = useViewer();

  const role = viewer?.role as UserRole | undefined;
  const isPro = role === 'PRO' || role === 'FOUNDING_RIDER' || role === 'ADMIN';
  const isFree = role === 'FREE';

  return {
    role,
    isPro,
    isFree,
    loading,
    error,
  };
}
