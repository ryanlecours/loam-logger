import { GoogleLogin } from '@react-oauth/google'
import { useApolloClient } from '@apollo/client'

export default function LoginButton() {
  const apollo = useApolloClient()

  return (
    <GoogleLogin
          useOneTap
          onSuccess={async (credentialResponse) => {
            try {
              const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: credentialResponse.credential }),
              });

              if (!res.ok) throw new Error('Google login failed');

               await apollo.refetchQueries({ include: ['Me'] })
            } catch (err) {
              console.error('Google login error', err);
              alert('Login failed. Try again.');
            }
          }}
          shape="rectangular"
          theme="filled_black"
          size="large"
          width="250"
        />
  )
}
