import { gql } from '@apollo/client';

// The richer sibling of logComponentService: one log with its kind, notes,
// and (since parts and cost landed) what was fitted and what it cost. The web
// modals call it once per selected component.
export const LOG_SERVICE = gql`
  mutation LogService($input: LogServiceInput!) {
    logService(input: $input) {
      id
      performedAt
      kind
      hoursAtService
      notes
      costMinor
      currency
      parts {
        id
        brand
        model
        priceMinor
        vendor
      }
    }
  }
`;
