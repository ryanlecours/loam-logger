import * as Sentry from '@sentry/node';
import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server';
import type { GraphQLFormattedError } from 'graphql';
import type { GraphQLContext } from '../server';

/**
 * Extension codes that indicate *client-side* issues — bad input, missing auth,
 * forbidden access. These are expected and don't warrant a Sentry alert.
 * Anything else (thrown resolver, Prisma error, network timeout) should surface.
 */
const CLIENT_ERROR_CODES = new Set([
  'BAD_USER_INPUT',
  'GRAPHQL_VALIDATION_FAILED',
  'GRAPHQL_PARSE_FAILED',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
]);

function isClientError(err: GraphQLFormattedError): boolean {
  const code = err.extensions?.code;
  return typeof code === 'string' && CLIENT_ERROR_CODES.has(code);
}

/**
 * Apollo Server plugin that turns GraphQL errors into first-class Sentry
 * events with operation name, query (truncated), and variables as context.
 *
 * `beforeSend` in instrument.ts scrubs sensitive keys from variables before
 * transmission, so `{ newPassword: '...' }` lands in Sentry as `[Filtered]`.
 *
 * Client errors (validation, auth failures) are skipped — those are expected
 * and just noise in the alerting channel.
 */
export function sentryApolloPlugin(): ApolloServerPlugin<GraphQLContext> {
  return {
    async requestDidStart() {
      return {
        async didEncounterErrors(ctx: GraphQLRequestContext<GraphQLContext>) {
          if (!ctx.errors) return;
          for (const err of ctx.errors) {
            if (isClientError(err)) continue;

            Sentry.withScope((scope) => {
              scope.setTag('graphql.operation', ctx.request.operationName ?? 'anonymous');
              scope.setTag('graphql.source', 'apollo-plugin');
              scope.setContext('graphql', {
                operationName: ctx.request.operationName ?? null,
                // Variables may contain sensitive input (e.g. newPassword for
                // reset-password); beforeSend scrubs those keys before send.
                variables: ctx.request.variables ?? null,
                // Truncate the query so we don't ship massive documents on
                // every error.
                query: ctx.request.query?.slice(0, 2000) ?? null,
              });
              // Prefer the original error (with its real stack) over Apollo's
              // wrapper, which otherwise swallows the useful trace.
              const originalError = err.extensions?.originalError;
              const toCapture =
                originalError instanceof Error ? originalError : err;
              Sentry.captureException(toCapture);
            });
          }
        },
      };
    },
  };
}
