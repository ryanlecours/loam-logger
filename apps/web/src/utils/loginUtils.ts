
import { useLocation } from 'react-router-dom'

export function useRedirectFrom(defaultPath = '/dashboard') {
  const location = useLocation()
  const state = location.state as { from?: { pathname: string } } | null
  return state?.from?.pathname ?? defaultPath
}