import { gql } from '@apollo/client'

export const UPDATE_USER_PREFERENCES_MUTATION = gql`
  mutation UpdateUserPreferences($input: UpdateUserPreferencesInput!) {
    updateUserPreferences(input: $input) {
      id
      hoursDisplayPreference
      predictionMode
    }
  }
`
