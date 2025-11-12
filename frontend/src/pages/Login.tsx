import { useApolloClient } from '@apollo/client'
import { GoogleLogin } from '@react-oauth/google'
import ConnectGarminLink from '../components/ConnectGarminLink'



export default function Login() {
  const apollo = useApolloClient();


  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="bg-surface max-w-md w-full shadow-xl rounded-md p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">Log In to LoamLogger</h2>
        <p className="m-2">Authenticate to access your rides and gear.</p>

        {/* Google login button */}
        <div className="flex flex-col items-center justify-center w-full mt-6 ">
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
          shape="pill"
          theme="filled_blue"
          size="large"
          width="200"
        />

        {/* Optional Garmin connect link below */}
        <div className="mt-6">
          <ConnectGarminLink isLoading={false}/>
        </div>
        </div>
      </div>
    </div>
  )
}
