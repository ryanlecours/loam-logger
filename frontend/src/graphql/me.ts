import { gql, useQuery } from '@apollo/client'

export const ME_QUERY = gql`
  query Me {
    me {
      id
   	  email
      name
      avatarUrl
      onboardingCompleted
      location
      age
    }
  }
`

export function useViewer() {
  const { data, loading, error, refetch } = useQuery(ME_QUERY, {
    fetchPolicy: 'cache-first',
  })
  return { viewer: data?.me ?? null, loading, error, refetch }
}
