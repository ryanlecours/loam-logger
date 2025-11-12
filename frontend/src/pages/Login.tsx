import { useApolloClient } from '@apollo/client'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import ConnectGarminLink from '../components/ConnectGarminLink'
import { ME_QUERY } from '../graphql/me'



export default function Login() {
  const apollo = useApolloClient()

  async function handleLoginSuccess(resp: CredentialResponse) {
    const credential = resp.credential
    if (!credential) {
      console.error('[GoogleLogin] Missing credential in response', resp)
      alert('Google login did not return a valid credential.')
      return
    }

    try {
      console.log('[GoogleLogin] Received credential, sending to backend...')
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })

      if (!res.ok) {
        const text = await res.text()
        console.error('[GoogleLogin] Backend responded with error', res.status, text)
        alert(`Login failed: ${res.statusText}`)
        return
      }

      console.log('[GoogleLogin] Backend verified credential successfully')

      await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' })
    } catch (err) {
      console.error('[GoogleLogin] Network or unexpected error', err)
      alert('A network error occurred during login. Please try again.')
    }
  }

  function handleLoginError() {
    console.error('[GoogleLogin] Google login widget reported error')
    alert('Google login failed. Please try again.')
  }


  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="bg-surface max-w-md w-full shadow-xl rounded-md p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">Log In to LoamLogger</h2>
        <p className="m-2">Authenticate to access your rides and gear.</p>

        {/* Google login button */}
        <div className="flex flex-col items-center justify-center w-full mt-6 ">
          <GoogleLogin
            useOneTap
            onSuccess={handleLoginSuccess}
            onError={handleLoginError}
            shape="pill"
            theme="filled_blue"
            size="large"
            width="200"
          />

          {/* Garmin link will go here once API access is granted. */}
          <div className="mt-6">
            <ConnectGarminLink />
          </div>
        </div>
      </div>
    </div>
  )
}
