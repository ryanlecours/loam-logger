import { parse } from 'graphql';
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

const mockInfo = logger.info as jest.Mock;
const mockCapture = captureServerEvent as jest.Mock;

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

const CURRENT_GEAR_QUERY = `
  query Gear {
    bikes { id prediction { components { status hoursUntilDue } } }
    components { hoursSinceInspection serviceExtensionHours }
  }
`;

async function run(query: string, userId: string | null, operationName = 'Gear') {
  const plugin = deprecatedFieldUsagePlugin();
  const listener = await plugin.requestDidStart!({} as never);
  const ctx = {
    document: parse(query),
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
  it('finds deprecated fields inside fragments, once each, sorted', () => {
    expect(findDeprecatedFields(parse(OLD_GEAR_QUERY))).toEqual([
      'inspectionHoursRemaining',
      'inspectionIntervalHours',
      'inspectionStatus',
      'limitingClock',
    ]);
  });

  it('ignores the live Component.hoursSinceInspection', () => {
    expect(findDeprecatedFields(parse(CURRENT_GEAR_QUERY))).toEqual([]);
  });

  it('finds Component.inspectionDueAtHours', () => {
    expect(findDeprecatedFields(parse('{ component(id: "c") { inspectionDueAtHours } }'))).toEqual([
      'inspectionDueAtHours',
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
        fields: expect.arrayContaining(['limitingClock']),
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
    await run(CURRENT_GEAR_QUERY, 'user_1');

    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('reports each caller once a day, however often the query runs', async () => {
    await run(OLD_GEAR_QUERY, 'user_1');
    await run(OLD_GEAR_QUERY, 'user_1');
    await run(OLD_GEAR_QUERY, 'user_2');

    expect(mockInfo).toHaveBeenCalledTimes(2);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('logs signed-out requests without sending an analytics event', async () => {
    await run(OLD_GEAR_QUERY, null);

    expect(mockInfo).toHaveBeenCalledWith(expect.objectContaining({ userId: null }), expect.any(String));
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
