import { gql } from '@apollo/client'

export const ACCEPT_TERMS_MUTATION = gql`
  mutation AcceptTerms($input: AcceptTermsInput!) {
    acceptTerms(input: $input) {
      success
      acceptedAt
    }
  }
`
