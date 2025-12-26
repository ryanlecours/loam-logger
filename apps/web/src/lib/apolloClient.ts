import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
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
  link: from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache(),
});

export default client;
