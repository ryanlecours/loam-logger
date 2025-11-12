import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { ME_QUERY } from '../graphql/me'

export default function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, loading } = useQuery(ME_QUERY, {
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
  })

  if (loading && !data?.me) return <div className="p-6">Loading…</div>
  if (!data?.me) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <>{children}</>
}
