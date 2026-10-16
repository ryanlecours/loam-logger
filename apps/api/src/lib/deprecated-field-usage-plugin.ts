import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server';
import {
  Kind,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type GraphQLSchema,
} from 'graphql';
import type { GraphQLContext } from '../server';
import { logger } from './logger';
import { captureServerEvent } from './posthog';
import { getRequestContext } from './requestContext';

/**
 * The deprecated fields a document selects, as `Type.field`, sorted and
 * without duplicates.
 *
 * Deprecation is read from the schema itself (`@deprecated`), with each field
 * resolved against its parent type. So a newly deprecated field is tracked
 * with no list to update, and a deprecated field that shares its name with a
 * live one on another type (`ComponentPrediction.hoursSinceInspection` and
 * `Component.hoursSinceInspection`) is told apart.
 */
export function findDeprecatedFields(schema: GraphQLSchema, document: DocumentNode): string[] {
  const found = new Set<string>();
  const typeInfo = new TypeInfo(schema);
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      [Kind.FIELD]() {
        const field = typeInfo.getFieldDef();
        const parent = typeInfo.getParentType();
        if (field?.deprecationReason != null && parent) {
          found.add(`${parent.name}.${field.name}`);
        }
      },
    })
  );
  return [...found].sort();
}

// The Gear query runs on every app open, so report each caller and operation
// at most once a day per process. Keying on the operation too keeps a rider's
// calibration or history query from being hidden behind their Gear query. The
// map is cleared if it ever grows past the cap, which at worst repeats a
// report. Each API instance keeps its own map, so a caller can appear once per
// instance per day.
const MAX_TRACKED_KEYS = 10_000;
const lastReportedDay = new Map<string, string>();

function shouldReport(key: string, day: string): boolean {
  if (lastReportedDay.get(key) === day) return false;
  if (lastReportedDay.size >= MAX_TRACKED_KEYS) lastReportedDay.clear();
  lastReportedDay.set(key, day);
  return true;
}

/** Test hook: forget which callers were reported today. */
export function resetDeprecatedFieldReports(): void {
  lastReportedDay.clear();
}

/**
 * Records requests that still select deprecated fields, so they can be removed
 * once no released client needs them (#333: mobile builds up to 1.3.0 select
 * the inspection-clock fields, and the app cannot force an update).
 *
 * Every report is logged, which counts all riders. The PostHog event
 * `deprecated_graphql_fields_requested` carries the operation and fields, plus
 * `client_platform`, which captureServerEvent adds from the request. It skips
 * riders who opted out of analytics, so read it as a lower bound. Released
 * builds do not send their app version, so "still requested" is the signal,
 * not a version number.
 */
export function deprecatedFieldUsagePlugin(): ApolloServerPlugin<GraphQLContext> {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx: GraphQLRequestContext<GraphQLContext>) {
          if (!ctx.document) return;
          const fields = findDeprecatedFields(ctx.schema, ctx.document);
          if (fields.length === 0) return;

          const userId = ctx.contextValue.user?.id ?? null;
          const operationName = ctx.operationName ?? ctx.request.operationName ?? 'anonymous';
          const day = new Date().toISOString().slice(0, 10);
          if (!shouldReport(`${userId ?? 'anonymous'}:${operationName}`, day)) return;

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
