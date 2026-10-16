import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server';
import { Kind, visit, type DocumentNode } from 'graphql';
import type { GraphQLContext } from '../server';
import { logger } from './logger';
import { captureServerEvent } from './posthog';
import { getRequestContext } from './requestContext';

/**
 * Deprecated schema fields still selected by released clients, by field name.
 * Every name here is unique to its deprecated field across the schema, so a
 * name match needs no type information. (`hoursSinceInspection` is left out:
 * the deprecated prediction field shares its name with a live Component field,
 * and the old builds that select one always select the others.)
 *
 * Mobile builds up to 1.3.0 select all of these in the Gear, calibration and
 * component history queries, and the app cannot force an update. Removing a
 * field fails the whole query for those builds, so the fields stay until this
 * plugin shows nobody asks for them (#333).
 */
export const DEPRECATED_FIELDS: ReadonlySet<string> = new Set([
  'inspectionStatus',
  'inspectionIntervalHours',
  'inspectionHoursRemaining',
  'limitingClock',
  'inspectionDueAtHours',
]);

/** The deprecated fields a document selects, sorted, without duplicates. */
export function findDeprecatedFields(document: DocumentNode): string[] {
  const found = new Set<string>();
  visit(document, {
    [Kind.FIELD](node) {
      if (DEPRECATED_FIELDS.has(node.name.value)) found.add(node.name.value);
    },
  });
  return [...found].sort();
}

// The Gear query runs on every app open, so report each caller at most once a
// day per process. The map is cleared if it ever grows past the cap, which at
// worst repeats a report.
const MAX_TRACKED_CALLERS = 10_000;
const lastReportedDay = new Map<string, string>();

function shouldReport(caller: string, day: string): boolean {
  if (lastReportedDay.get(caller) === day) return false;
  if (lastReportedDay.size >= MAX_TRACKED_CALLERS) lastReportedDay.clear();
  lastReportedDay.set(caller, day);
  return true;
}

/** Test hook: forget which callers were reported today. */
export function resetDeprecatedFieldReports(): void {
  lastReportedDay.clear();
}

/**
 * Records requests that still select deprecated fields, so they can be removed
 * once no released client needs them.
 *
 * Every report is logged, which counts all riders. The PostHog event
 * `deprecated_graphql_fields_requested` adds the user and the client platform
 * for charting, but skips riders who opted out of analytics, so read it as a
 * lower bound. Released builds do not send their app version, so "still
 * requested" is the signal, not a version number.
 */
export function deprecatedFieldUsagePlugin(): ApolloServerPlugin<GraphQLContext> {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx: GraphQLRequestContext<GraphQLContext>) {
          if (!ctx.document) return;
          const fields = findDeprecatedFields(ctx.document);
          if (fields.length === 0) return;

          const userId = ctx.contextValue.user?.id ?? null;
          const day = new Date().toISOString().slice(0, 10);
          if (!shouldReport(userId ?? 'anonymous', day)) return;

          const operationName = ctx.operationName ?? ctx.request.operationName ?? 'anonymous';
          logger.info(
            {
              event: 'deprecated_graphql_fields_requested',
              userId,
              operationName,
              fields,
              client: getRequestContext()?.client?.platform ?? null,
            },
            '[GraphQL] Request selects deprecated fields'
          );
          if (userId) {
            captureServerEvent(userId, 'deprecated_graphql_fields_requested', {
              operation_name: operationName,
              fields,
            });
          }
        },
      };
    },
  };
}
