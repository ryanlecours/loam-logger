import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';

const graphqlUrl = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/graphql`
  : '/graphql'; // works if you proxy /graphql in dev

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    for (const e of graphQLErrors) console.warn('[GraphQL error]', e.message);
  }
  if (networkError) console.warn('[Network error]', networkError);
});

const httpLink = new HttpLink({
  uri: graphqlUrl,
  credentials: 'include',
});

const client = new ApolloClient({
  link: from([errorLink, httpLink]),
  cache: new InMemoryCache(),
});

export default client;
