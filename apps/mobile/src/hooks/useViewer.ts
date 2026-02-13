import { useCallback } from 'react';
import { useMeQuery } from '@loam/graphql';

interface UseViewerOptions {
  /**
   * Skip the ME query (e.g., when not authenticated)
   */
  skip?: boolean;
}

/**
 * Wrapper hook around the ME query for fetching the current viewer.
 * Used by useAuth to fetch full user data after login.
 */
export function useViewer(options: UseViewerOptions = {}) {
  const { data, loading, error, refetch } = useMeQuery({
    skip: options.skip,
    fetchPolicy: 'network-only', // Always fetch fresh data
    notifyOnNetworkStatusChange: true,
  });

  const refetchViewer = useCallback(() => {
    return refetch();
  }, [refetch]);

  return {
    viewer: data?.me ?? null,
    loading,
    error,
    refetchViewer,
  };
}
