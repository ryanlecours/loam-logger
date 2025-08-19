import { gql } from '@apollo/client';

export const BIKES = gql`
  query Bikes {
    bikes {
      id
      name
    }
  }
`;