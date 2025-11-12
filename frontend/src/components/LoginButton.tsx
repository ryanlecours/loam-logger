import { useGoogleLogin } from '@react-oauth/google'
import { useApolloClient } from '@apollo/client'

export default function LoginButton() {
  const apollo = useApolloClient()

  const login = useGoogleLogin({
    flow: 'auth-code',
    onSuccess: async ({ code }) => {
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!resp.ok) throw new Error('Auth failed')

      // Refresh the viewer after login so UI updates immediately
      await apollo.refetchQueries({ include: ['Me'] })
    },
    onError: (err) => {
      console.error('Google login error', err)
      alert('Google sign-in failed. Try again.')
    },
  })

  return (
    <button onClick={() => login()} className="btn btn-primary">
      Continue with Google
    </button>
  )
}
