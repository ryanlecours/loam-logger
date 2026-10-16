import { buildASTSchema, buildSchema, isObjectType, parse, type GraphQLSchema } from 'graphql';
import type { GraphQLRequestContext } from '@apollo/server';
import type { GraphQLContext } from '../server';

jest.mock('./logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('./posthog', () => ({
  captureServerEvent: jest.fn(),
}));

jest.mock('./requestContext', () => ({
  getRequestContext: jest.fn(() => ({ client: { platform: 'ios' } })),
}));

import {
  deprecatedFieldUsagePlugin,
  findDeprecatedFields,
  resetDeprecatedFieldReports,
} from './deprecated-field-usage-plugin';
import { logger } from './logger';
import { captureServerEvent } from './posthog';
import { typeDefs } from '../graphql/schema';

const mockInfo = logger.info as jest.Mock;
const mockCapture = captureServerEvent as jest.Mock;

// The shape of the real schema around the inspection-clock fields, small
// enough to read. The real schema is checked separately below.
const schema = buildSchema(`
  type Query {
    bikes: [Bike!]!
    component(id: ID!): Component
  }
  type Bike {
    id: ID!
    prediction: BikePrediction
  }
  type BikePrediction {
    components: [ComponentPrediction!]!
  }
  type ComponentPrediction {
    status: String
    hoursUntilDue: Float
    inspectionStatus: String @deprecated(reason: "old clock")
    inspectionIntervalHours: Float @deprecated(reason: "old clock")
    hoursSinceInspection: Float @deprecated(reason: "old clock")
    inspectionHoursRemaining: Float @deprecated(reason: "old clock")
    limitingClock: String @deprecated(reason: "old clock")
  }
  type Component {
    id: ID!
    hoursSinceInspection: Float!
    serviceExtensionHours: Float
    inspectionDueAtHours: Float @deprecated(reason: "column dropped")
  }
`);

// The selection mobile 1.3.0's Gear query makes, through a fragment.
const OLD_GEAR_QUERY = `
  query Gear {
    bikes { id prediction { components { ...Pred } } }
  }
  fragment Pred on ComponentPrediction {
    status
    inspectionStatus
    inspectionIntervalHours
    hoursSinceInspection
    inspectionHoursRemaining
    limitingClock
  }
`;

const CURRENT_HISTORY_QUERY = `
  query ComponentHistory {
    component(id: "c") { id hoursSinceInspection serviceExtensionHours }
    bikes { prediction { components { status hoursUntilDue } } }
  }
`;

async function run(
  query: string,
  userId: string | null,
  operationName = 'Gear',
  document: ReturnType<typeof parse> | null = parse(query)
) {
  const plugin = deprecatedFieldUsagePlugin();
  const listener = await plugin.requestDidStart!({} as never);
  const ctx = {
    schema,
    document,
    operationName,
    request: { operationName },
    contextValue: { user: userId ? { id: userId } : null },
  } as unknown as GraphQLRequestContext<GraphQLContext>;
  await (listener as { didResolveOperation: (c: typeof ctx) => Promise<void> }).didResolveOperation(ctx);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetDeprecatedFieldReports();
});

describe('findDeprecatedFields', () => {
  it('finds deprecated fields inside fragments, by parent type, once each', () => {
    expect(findDeprecatedFields(schema, parse(OLD_GEAR_QUERY))).toEqual([
      'ComponentPrediction.hoursSinceInspection',
      'ComponentPrediction.inspectionHoursRemaining',
      'ComponentPrediction.inspectionIntervalHours',
      'ComponentPrediction.inspectionStatus',
      'ComponentPrediction.limitingClock',
    ]);
  });

  it('ignores the live Component.hoursSinceInspection, which shares a deprecated name', () => {
    expect(findDeprecatedFields(schema, parse(CURRENT_HISTORY_QUERY))).toEqual([]);
  });

  it('finds Component.inspectionDueAtHours', () => {
    expect(
      findDeprecatedFields(schema, parse('{ component(id: "c") { inspectionDueAtHours } }'))
    ).toEqual(['Component.inspectionDueAtHours']);
  });
});

describe('the real schema', () => {
  function deprecatedFieldsOf(s: GraphQLSchema): string[] {
    return Object.values(s.getTypeMap())
      .filter(isObjectType)
      .filter((t) => !t.name.startsWith('__'))
      .flatMap((t) =>
        Object.values(t.getFields())
          .filter((f) => f.deprecationReason != null)
          .map((f) => `${t.name}.${f.name}`)
      )
      .sort();
  }

  // Pins the schema's deprecations, all of which the plugin tracks, so adding
  // or removing one is deliberate: #333's inspection-clock fields, and the
  // referral fields waiting for pre-removal app versions to age out.
  it('deprecates exactly the inspection-clock and referral fields', () => {
    expect(deprecatedFieldsOf(buildASTSchema(typeDefs))).toEqual([
      'Component.inspectionDueAtHours',
      'ComponentPrediction.hoursSinceInspection',
      'ComponentPrediction.inspectionHoursRemaining',
      'ComponentPrediction.inspectionIntervalHours',
      'ComponentPrediction.inspectionStatus',
      'ComponentPrediction.limitingClock',
      'Query.referralStats',
      'User.referralCode',
    ]);
  });
});

describe('deprecatedFieldUsagePlugin', () => {
  it('logs and tracks a request that selects deprecated fields', async () => {
    await run(OLD_GEAR_QUERY, 'user_1');

    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'deprecated_graphql_fields_requested',
        userId: 'user_1',
        operationName: 'Gear',
        client: 'ios',
        fields: expect.arrayContaining(['ComponentPrediction.limitingClock']),
      }),
      expect.any(String)
    );
    expect(mockCapture).toHaveBeenCalledWith(
      'user_1',
      'deprecated_graphql_fields_requested',
      expect.objectContaining({ operation_name: 'Gear' })
    );
  });

  it('stays quiet for current clients', async () => {
    await run(CURRENT_HISTORY_QUERY, 'user_1', 'ComponentHistory');

    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('reports each caller and operation once a day, however often it runs', async () => {
    await run(OLD_GEAR_QUERY, 'user_1');
    await run(OLD_GEAR_QUERY, 'user_1');
    await run('{ component(id: "c") { inspectionDueAtHours } }', 'user_1', 'ComponentHistory');
    await run(OLD_GEAR_QUERY, 'user_2');

    expect(mockInfo).toHaveBeenCalledTimes(3);
    expect(mockCapture.mock.calls.map(([user, , props]) => `${user}:${props.operation_name}`)).toEqual([
      'user_1:Gear',
      'user_1:ComponentHistory',
      'user_2:Gear',
    ]);
  });

  it('logs signed-out requests without sending an analytics event', async () => {
    await run(OLD_GEAR_QUERY, null);

    expect(mockInfo).toHaveBeenCalledWith(expect.objectContaining({ userId: null }), expect.any(String));
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('does nothing when the request has no parsed document', async () => {
    await run(OLD_GEAR_QUERY, 'user_1', 'Gear', null);

    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
