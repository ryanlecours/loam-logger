// Mock @sentry/node before importing the plugin so its withScope/captureException calls are spies
jest.mock('@sentry/node', () => {
  const scope = {
    setTag: jest.fn(),
    setContext: jest.fn(),
  };
  return {
    withScope: jest.fn((fn: (s: typeof scope) => void) => fn(scope)),
    captureException: jest.fn(),
    __testScope: scope,
  };
});

import * as Sentry from '@sentry/node';
import { sentryApolloPlugin } from './sentry-apollo-plugin';
import { GraphQLError } from 'graphql';

const mockedSentry = Sentry as unknown as {
  withScope: jest.Mock;
  captureException: jest.Mock;
  __testScope: { setTag: jest.Mock; setContext: jest.Mock };
};

type MinimalCtx = {
  request: {
    operationName?: string | null;
    variables?: Record<string, unknown> | null;
    query?: string | null;
  };
  errors: readonly GraphQLError[];
};

async function runDidEncounterErrors(ctx: MinimalCtx): Promise<void> {
  const plugin = sentryApolloPlugin();
  const started = await plugin.requestDidStart!({} as never);
  await started?.didEncounterErrors?.(ctx as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sentryApolloPlugin — didEncounterErrors', () => {
  it('captures resolver errors to Sentry with operation name and query context', async () => {
    const resolverErr = new GraphQLError('Boom inside resolver');
    await runDidEncounterErrors({
      request: { operationName: 'GetRides', variables: { limit: 10 }, query: 'query GetRides { rides }' },
      errors: [resolverErr],
    });

    expect(mockedSentry.captureException).toHaveBeenCalledTimes(1);
    expect(mockedSentry.__testScope.setTag).toHaveBeenCalledWith('graphql.operation', 'GetRides');
    expect(mockedSentry.__testScope.setTag).toHaveBeenCalledWith('graphql.source', 'apollo-plugin');
    expect(mockedSentry.__testScope.setContext).toHaveBeenCalledWith(
      'graphql',
      expect.objectContaining({
        operationName: 'GetRides',
        variables: { limit: 10 },
        query: 'query GetRides { rides }',
      }),
    );
  });

  it('uses the originalError (not the Apollo wrapper) so the real stack is preserved', async () => {
    const root = new Error('DB connection refused');
    const wrapped = new GraphQLError('Internal server error', {
      extensions: { originalError: root },
    });
    await runDidEncounterErrors({
      request: { operationName: 'Anything', variables: null, query: null },
      errors: [wrapped],
    });

    expect(mockedSentry.captureException).toHaveBeenCalledWith(root);
  });

  it('does NOT capture BAD_USER_INPUT client errors', async () => {
    const clientErr = new GraphQLError('Invalid input', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
    await runDidEncounterErrors({
      request: { operationName: 'Op', variables: null, query: null },
      errors: [clientErr],
    });

    expect(mockedSentry.captureException).not.toHaveBeenCalled();
  });

  it('does NOT capture UNAUTHENTICATED errors', async () => {
    const authErr = new GraphQLError('Must log in', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
    await runDidEncounterErrors({
      request: { operationName: 'Op', variables: null, query: null },
      errors: [authErr],
    });

    expect(mockedSentry.captureException).not.toHaveBeenCalled();
  });

  it('does NOT capture FORBIDDEN errors', async () => {
    const forbidden = new GraphQLError('Not allowed', {
      extensions: { code: 'FORBIDDEN' },
    });
    await runDidEncounterErrors({
      request: { operationName: 'Op', variables: null, query: null },
      errors: [forbidden],
    });

    expect(mockedSentry.captureException).not.toHaveBeenCalled();
  });

  it('does NOT capture validation errors', async () => {
    const validation = new GraphQLError('bad query syntax', {
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
    await runDidEncounterErrors({
      request: { operationName: 'Op', variables: null, query: null },
      errors: [validation],
    });

    expect(mockedSentry.captureException).not.toHaveBeenCalled();
  });

  it('captures each non-client error when multiple are in a single response', async () => {
    const client = new GraphQLError('bad input', { extensions: { code: 'BAD_USER_INPUT' } });
    const serverA = new GraphQLError('Boom A');
    const serverB = new GraphQLError('Boom B');

    await runDidEncounterErrors({
      request: { operationName: 'Batch', variables: null, query: null },
      errors: [client, serverA, serverB],
    });

    // Client error skipped, both server errors captured.
    expect(mockedSentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('truncates large query strings to keep event size bounded', async () => {
    const hugeQuery = 'query X { x }'.repeat(500); // ~6000+ chars
    await runDidEncounterErrors({
      request: { operationName: 'Huge', variables: null, query: hugeQuery },
      errors: [new GraphQLError('Boom')],
    });

    const setContextCall = mockedSentry.__testScope.setContext.mock.calls[0];
    const gqlContext = setContextCall[1] as { query: string };
    expect(gqlContext.query.length).toBeLessThanOrEqual(2000);
  });

  it('falls back to "anonymous" when operation has no name', async () => {
    await runDidEncounterErrors({
      request: { operationName: null, variables: null, query: null },
      errors: [new GraphQLError('Boom')],
    });

    expect(mockedSentry.__testScope.setTag).toHaveBeenCalledWith('graphql.operation', 'anonymous');
  });
});
