import { gql, useQuery } from '@apollo/client'

export const ME_QUERY = gql`
  query Me {
    me {
      id
   	  email
      name
      avatarUrl
      onboardingCompleted
      hasAcceptedCurrentTerms
      location
      age
      role
      isFoundingRider
      subscriptionTier
      referralCode
      needsDowngradeSelection
      tierLimits {
        maxBikes
        allowedComponentTypes
        currentBikeCount
        canAddBike
      }
      hasPassword
      needsReauthForSensitiveActions
      hoursDisplayPreference
      predictionMode
      distanceUnit
      analyticsOptOut
      pairedComponentMigrationSeenAt
      createdAt
    }
  }
`

export function useViewer() {
  const { data, loading, error, refetch } = useQuery(ME_QUERY, {
    fetchPolicy: 'cache-first',
  })
  return { viewer: data?.me ?? null, loading, error, refetch }
}
