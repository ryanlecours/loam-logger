import { describe, it, expect, vi } from 'vitest';
import { ApolloClient, HttpLink, InMemoryCache, gql } from '@apollo/client';
import { PUBLIC_QUERY_CONTEXT } from './publicQuery';

const QUERY = gql`
  query Probe {
    probe
  }
`;

// Same link options as the app's client, so this checks that the per-query
// context really overrides credentials: 'include'.
const clientWithFetch = (fetch: typeof globalThis.fetch) =>
  new ApolloClient({
    link: new HttpLink({ uri: 'https://api.example.test/graphql', credentials: 'include', fetch }),
    cache: new InMemoryCache(),
  });

const okFetch = () =>
  vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ data: { probe: true } }), {
        headers: { 'content-type': 'application/json' },
      })
  );

describe('PUBLIC_QUERY_CONTEXT', () => {
  it('sends the request without cookies', async () => {
    const fetch = okFetch();
    await clientWithFetch(fetch).query({ query: QUERY, context: PUBLIC_QUERY_CONTEXT });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  });

  it('leaves other queries on the client default', async () => {
    const fetch = okFetch();
    await clientWithFetch(fetch).query({ query: QUERY });
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });
});
