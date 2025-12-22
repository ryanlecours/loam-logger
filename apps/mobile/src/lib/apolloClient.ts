import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
  fromPromise,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { getAccessToken, refreshAccessToken } from './auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

const httpLink = new HttpLink({
  uri: `${API_URL}/graphql`,
  credentials: 'include',
});

const authLink = setContext(async (_, { headers }) => {
  const token = await getAccessToken();

  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  };
});

const errorLink = onError(
  ({ graphQLErrors, networkError, operation, forward }) => {
    if (graphQLErrors) {
      for (const err of graphQLErrors) {
        if (err.extensions?.code === 'UNAUTHENTICATED') {
          return fromPromise(
            refreshAccessToken()
              .then((newToken) => {
                if (!newToken) {
                  throw new Error('Unable to refresh token');
                }

                const oldHeaders = operation.getContext().headers;
                operation.setContext({
                  headers: {
                    ...oldHeaders,
                    authorization: `Bearer ${newToken}`,
                  },
                });

                return forward(operation);
              })
              .catch(() => {
                return forward(operation);
              })
          ).flatMap(() => forward(operation));
        }
      }
    }

    if (networkError) {
      console.warn(`[Network error]: ${networkError}`);
    }
  }
);

export const client = new ApolloClient({
  link: ApolloLink.from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
});
