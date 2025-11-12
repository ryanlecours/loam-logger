import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import { useGoogleLogin } from '@react-oauth/google'
import ConnectGarminLink from '../components/ConnectGarminLink'
import { useRedirectFrom } from '../utils/loginUtils'



export default function Login() {
  const navigate = useNavigate();
  const apollo = useApolloClient();

  const [loading, setLoading] = useState(false);
  const from = useRedirectFrom();

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    onSuccess: async ({ code }) => {
      try {
        setLoading(true)
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })

        if (!res.ok) throw new Error('Google login failed')

        await apollo.resetStore()

        navigate(from, { replace: true })
      } catch (err) {
        console.error(err)
        alert('Login failed. Try again.')
      } finally {
        setLoading(false)
      }
    },
    onError: (errorResponse) => {
    console.error('Google login error', errorResponse)
  },
  })

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="bg-surface max-w-md w-full shadow-xl rounded-md p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">Log In to LoamLogger</h2>
        <p className="m-2">Authenticate to access your rides and gear.</p>

        {/* Google login button */}
        <button
          onClick={() => googleLogin()}
          disabled={loading}
          className={`flex items-center justify-center gap-3 w-full py-3 rounded-md font-medium transition ${
            loading
              ? 'btn-disabled'
              : 'btn-primary hover:btn-primary-dark focus:btn-primary-dark'
          }`}
        >
          {loading ? (
            <svg
              className="animate-spin h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8z"
              ></path>
            </svg>
          ) : (
            <>
              <span>Continue with Google</span>
            </>
          )}
        </button>

        {/* Optional Garmin connect link below */}
        <div className="mt-6">
          <ConnectGarminLink isLoading={loading}/>
        </div>
      </div>
    </div>
  )
}
