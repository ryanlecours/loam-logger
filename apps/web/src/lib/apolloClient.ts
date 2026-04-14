import { ApolloClient, ApolloLink, InMemoryCache, HttpLink, from } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import * as Sentry from '@sentry/react';
import { getCsrfToken } from './csrf';

const graphqlUrl = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/graphql`
  : '/graphql'; // works if you proxy /graphql in dev

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    for (const e of graphQLErrors) console.warn('[GraphQL error]', e.message);
  }
  if (networkError) console.warn('[Network error]', networkError);
});

// Record a Sentry breadcrumb per GraphQL operation with its name and duration.
// Gives error events context like "before this crash, user ran RidesQuery then
// DeleteRideMutation". Variables are intentionally excluded — they may contain
// sensitive input (e.g. newPassword for reset flows).
const sentryBreadcrumbLink = new ApolloLink((operation, forward) => {
  const started = performance.now();
  return forward(operation).map((result) => {
    Sentry.addBreadcrumb({
      category: 'graphql',
      type: 'http',
      level: result.errors?.length ? 'warning' : 'info',
      message: operation.operationName || 'anonymous',
      data: {
        durationMs: Math.round(performance.now() - started),
        hasErrors: Boolean(result.errors?.length),
      },
    });
    return result;
  });
});

const authLink = setContext((_, { headers }) => {
  const csrfToken = getCsrfToken();
  return {
    headers: {
      ...headers,
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
  };
});

const httpLink = new HttpLink({
  uri: graphqlUrl,
  credentials: 'include',
});

const client = new ApolloClient({
  link: from([errorLink, sentryBreadcrumbLink, authLink, httpLink]),
  // Disable canonizeResults to avoid frozen-object and object-identity issues in React strict mode
  cache: new InMemoryCache({ canonizeResults: false }),
});

export default client;
