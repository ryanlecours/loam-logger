import { useQuery, gql } from '@apollo/client';

const CONNECTED_ACCOUNTS_QUERY = gql`
  query ConnectedAccounts {
    me {
      id
      activeDataSource
      accounts {
        provider
        connectedAt
      }
    }
  }
`;

interface ConnectedAccount {
  provider: string;
  connectedAt: string;
}

interface UseConnectedAccountsResult {
  isStravaConnected: boolean;
  isGarminConnected: boolean;
  isWhoopConnected: boolean;
  activeDataSource: 'garmin' | 'strava' | 'whoop' | null;
  accounts: ConnectedAccount[];
  loading: boolean;
  refetch: () => void;
}

export function useConnectedAccounts(): UseConnectedAccountsResult {
  const { data, loading, refetch } = useQuery(CONNECTED_ACCOUNTS_QUERY, {
    fetchPolicy: 'cache-and-network',
  });

  const accounts: ConnectedAccount[] = data?.me?.accounts ?? [];
  const isStravaConnected = accounts.some((acc) => acc.provider === 'strava');
  const isGarminConnected = accounts.some((acc) => acc.provider === 'garmin');
  const isWhoopConnected = accounts.some((acc) => acc.provider === 'whoop');
  const activeDataSource = data?.me?.activeDataSource ?? null;

  return {
    isStravaConnected,
    isGarminConnected,
    isWhoopConnected,
    activeDataSource,
    accounts,
    loading,
    refetch,
  };
}
