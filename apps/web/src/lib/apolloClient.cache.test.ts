import { describe, it, expect } from 'vitest';
import { InMemoryCache, gql } from '@apollo/client';
import { typePolicies } from './apolloClient';

// Regression guard for the staged advisor-summary fetch: the dashboard writes
// core predictions (BIKES) and advisorSummary (BIKES_ADVISOR) to the same
// Bike.predictions field in two separate queries. Without normalizing
// BikePredictionSummary by bikeId, the second (partial) write clobbers the
// first — the advisor stage would wipe overallStatus/components from cache.
// This exercises the REAL typePolicies from apolloClient.ts.

const BIKES = gql`
  query Bikes {
    bikes {
      id
      predictions {
        bikeId
        overallStatus
        components {
          componentId
        }
      }
    }
  }
`;

const BIKES_ADVISOR = gql`
  query BikesAdvisor {
    bikes {
      id
      predictions {
        bikeId
        advisorSummary {
          text
        }
      }
    }
  }
`;

describe('apolloClient cache: BikePredictionSummary normalization', () => {
  const makeCache = () => new InMemoryCache({ canonizeResults: false, typePolicies });

  it('merges the separate advisor write into the cached predictions instead of clobbering', () => {
    const cache = makeCache();

    cache.writeQuery({
      query: BIKES,
      data: {
        bikes: [
          {
            __typename: 'Bike',
            id: 'bike-1',
            predictions: {
              __typename: 'BikePredictionSummary',
              bikeId: 'bike-1',
              overallStatus: 'DUE_SOON',
              components: [{ __typename: 'ComponentPrediction', componentId: 'c1' }],
            },
          },
        ],
      },
    });

    // Advisor stage arrives second with only bikeId + advisorSummary.
    cache.writeQuery({
      query: BIKES_ADVISOR,
      data: {
        bikes: [
          {
            __typename: 'Bike',
            id: 'bike-1',
            predictions: {
              __typename: 'BikePredictionSummary',
              bikeId: 'bike-1',
              advisorSummary: { __typename: 'AdvisorSummary', text: 'service the fork' },
            },
          },
        ],
      },
    });

    // Core predictions must survive the advisor write...
    const core = cache.readQuery<{
      bikes: Array<{ predictions: { overallStatus: string; components: Array<{ componentId: string }> } | null }>;
    }>({ query: BIKES });
    expect(core?.bikes[0]?.predictions?.overallStatus).toBe('DUE_SOON');
    expect(core?.bikes[0]?.predictions?.components).toHaveLength(1);
    expect(core?.bikes[0]?.predictions?.components?.[0]?.componentId).toBe('c1');

    // ...and the advisor summary must be readable from the same entity.
    const advisor = cache.readQuery<{
      bikes: Array<{ predictions: { advisorSummary: { text: string } | null } | null }>;
    }>({ query: BIKES_ADVISOR });
    expect(advisor?.bikes[0]?.predictions?.advisorSummary?.text).toBe('service the fork');
  });

  it('keys predictions by bikeId', () => {
    expect(typePolicies.BikePredictionSummary.keyFields).toEqual(['bikeId']);
  });
});
