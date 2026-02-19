import { useLocation, useSearchParams } from 'react-router-dom'

export function useRedirectFrom(defaultPath = '/dashboard') {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const state = location.state as { from?: { pathname: string } } | null

  // Check router state first, then query param, then default
  return state?.from?.pathname ?? searchParams.get('returnTo') ?? defaultPath
}