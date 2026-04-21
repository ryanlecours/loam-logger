import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { ME_QUERY } from '../graphql/me'
import { useSentryUser } from '../hooks/useSentryUser'
import { usePostHogUser } from '../hooks/usePostHogUser'

export default function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data, loading } = useQuery(ME_QUERY, {
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
  })

  // Tag browser-side Sentry events with the authenticated user's id so alerts
  // can surface who was affected. Clears on logout.
  useSentryUser()
  usePostHogUser()

  if (loading && !data?.me) return <div className="p-6">Loading…</div>
  if (!data?.me) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <>{children}</>
}
