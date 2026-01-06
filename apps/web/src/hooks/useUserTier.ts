import { useViewer } from '../graphql/me';

export type UserRole = 'FREE' | 'PRO' | 'ADMIN';

export function useUserTier() {
  const { viewer, loading, error } = useViewer();

  const role = viewer?.role as UserRole | undefined;
  const isPro = role === 'PRO' || role === 'ADMIN';
  const isFree = role === 'FREE';
  const isFoundingRider = viewer?.isFoundingRider ?? false;

  return {
    role,
    isPro,
    isFree,
    isFoundingRider,
    loading,
    error,
  };
}
