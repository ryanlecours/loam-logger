import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { gql, useQuery } from '@apollo/client'

const ME_QUERY = gql`
  query Me {
    me {
      id
      email
      name
      avatarUrl
    }
  }
`

export default function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, loading } = useQuery(ME_QUERY, { fetchPolicy: 'cache-first' })

  if (loading) return <div className="p-6">Loading…</div>
  if (!data?.me) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <>{children}</>
}
