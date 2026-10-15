import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApolloClient, HttpLink, InMemoryCache, from, gql } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { csrfRetryLink, isCsrfRejection } from './csrfRetryLink';
import { getCsrfToken } from './csrf';

const QUERY = gql`
  query Probe {
    probe
  }
`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CSRF_MISSING = { success: false, error: 'CSRF token missing', code: 'CSRF_MISSING' };

type Handler = (url: string, init: RequestInit | undefined) => Response;

// The API as the browser sees it: GraphQL answers by whether the request
// carries the right token, and /auth/csrf-token hands one out.
function stubApi(opts: { graphql: Handler; csrf?: Handler }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/csrf-token')) {
      return opts.csrf ? opts.csrf(url, init) : json(200, { csrfToken: 'fresh' });
    }
    return opts.graphql(url, init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const tokenSent = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string> | undefined)?.['x-csrf-token'];

const graphqlCalls = (fetch: ReturnType<typeof stubApi>) =>
  fetch.mock.calls.filter(([url]) => String(url).endsWith('/graphql'));
const csrfCalls = (fetch: ReturnType<typeof stubApi>) =>
  fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/csrf-token'));

// The same link order as the app's client: retry above the header-setting link.
const makeClient = () =>
  new ApolloClient({
    link: from([
      csrfRetryLink,
      setContext((_, { headers }) => {
        const token = getCsrfToken();
        return { headers: { ...headers, ...(token ? { 'x-csrf-token': token } : {}) } };
      }),
      new HttpLink({
        uri: 'https://api.example.test/graphql',
        credentials: 'include',
        fetch: (...args) => globalThis.fetch(...args),
      }),
    ]),
    cache: new InMemoryCache(),
  });

const requireToken: Handler = (_url, init) =>
  tokenSent(init) === 'fresh' ? json(200, { data: { probe: true } }) : json(403, CSRF_MISSING);

describe('csrfRetryLink', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('fetches a token and retries when a tab has none', async () => {
    const fetch = stubApi({ graphql: requireToken });

    const { data } = await makeClient().query({ query: QUERY, fetchPolicy: 'network-only' });

    expect(data).toEqual({ probe: true });
    const calls = graphqlCalls(fetch);
    expect(calls).toHaveLength(2);
    expect(tokenSent(calls[0][1])).toBeUndefined();
    expect(tokenSent(calls[1][1])).toBe('fresh');
    expect(getCsrfToken()).toBe('fresh');
  });

  it('shares one token fetch between requests rejected together', async () => {
    const fetch = stubApi({ graphql: requireToken });
    const client = makeClient();

    await Promise.all([
      client.query({ query: QUERY, fetchPolicy: 'network-only' }),
      client.query({ query: gql`query Probe2 { probe }`, fetchPolicy: 'network-only' }),
    ]);

    expect(csrfCalls(fetch)).toHaveLength(1);
  });

  it('recovers from a stale token left by a login in another tab', async () => {
    sessionStorage.setItem('ll_csrf_cache', 'stale');
    const fetch = stubApi({
      graphql: (_url, init) =>
        tokenSent(init) === 'fresh'
          ? json(200, { data: { probe: true } })
          : json(403, { ...CSRF_MISSING, code: 'CSRF_INVALID' }),
    });

    const { data } = await makeClient().query({ query: QUERY, fetchPolicy: 'network-only' });

    expect(data).toEqual({ probe: true });
    expect(graphqlCalls(fetch)).toHaveLength(2);
  });

  it('gives up with the original error when there is no session to get a token for', async () => {
    const fetch = stubApi({ graphql: requireToken, csrf: () => json(401, { error: 'Authentication required' }) });

    await expect(makeClient().query({ query: QUERY, fetchPolicy: 'network-only' })).rejects.toThrow(/403/);
    expect(graphqlCalls(fetch)).toHaveLength(1);
  });

  it('retries only once', async () => {
    const fetch = stubApi({ graphql: () => json(403, CSRF_MISSING) });

    await expect(makeClient().query({ query: QUERY, fetchPolicy: 'network-only' })).rejects.toThrow(/403/);
    expect(graphqlCalls(fetch)).toHaveLength(2);
    expect(csrfCalls(fetch)).toHaveLength(1);
  });

  it('leaves other failures alone', async () => {
    const fetch = stubApi({ graphql: () => json(403, { error: 'Forbidden' }) });

    await expect(makeClient().query({ query: QUERY, fetchPolicy: 'network-only' })).rejects.toThrow(/403/);
    expect(graphqlCalls(fetch)).toHaveLength(1);
    expect(csrfCalls(fetch)).toHaveLength(0);
  });
});

describe('isCsrfRejection', () => {
  it('matches only a 403 carrying a CSRF code', () => {
    expect(isCsrfRejection({ statusCode: 403, result: { code: 'CSRF_MISSING' } })).toBe(true);
    expect(isCsrfRejection({ statusCode: 403, result: { code: 'CSRF_INVALID' } })).toBe(true);
    expect(isCsrfRejection({ statusCode: 401, result: { code: 'CSRF_MISSING' } })).toBe(false);
    expect(isCsrfRejection({ statusCode: 403, result: { code: 'FORBIDDEN' } })).toBe(false);
    expect(isCsrfRejection(new Error('network down'))).toBe(false);
    expect(isCsrfRejection(null)).toBe(false);
  });
});
