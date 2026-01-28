import { gql, useMutation } from '@apollo/client'

export const UPDATE_USER_PREFERENCES_MUTATION = gql`
  mutation UpdateUserPreferences($input: UpdateUserPreferencesInput!) {
    updateUserPreferences(input: $input) {
      id
      hoursDisplayPreference
      predictionMode
    }
  }
`

export const MARK_PAIRED_COMPONENT_MIGRATION_SEEN_MUTATION = gql`
  mutation MarkPairedComponentMigrationSeen {
    markPairedComponentMigrationSeen {
      id
      pairedComponentMigrationSeenAt
    }
  }
`

export function useMarkPairedComponentMigrationSeen() {
  return useMutation(MARK_PAIRED_COMPONENT_MIGRATION_SEEN_MUTATION)
}

export const MIGRATE_PAIRED_COMPONENTS_MUTATION = gql`
  mutation MigratePairedComponents {
    migratePairedComponents {
      migratedCount
    }
  }
`

export function useMigratePairedComponents() {
  return useMutation(MIGRATE_PAIRED_COMPONENTS_MUTATION)
}
