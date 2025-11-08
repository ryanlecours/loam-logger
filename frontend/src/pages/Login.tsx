import { useState } from 'react';
import { FaMountain } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import ConnectGarminLink from '../components/ConnectGarminLink';

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);

    // Simulate async login (replace with real OAuth flow)
    setTimeout(() => {
      navigate('/dashboard');
    }, 1500);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="bg-surface max-w-md w-full shadow-xl rounded-md p-8 text-center">
        <h2 className="text-2xl font-bold mb-4">Log In to LoamLogger</h2>
        <p className="m-2">Authenticate to access your rides and gear.</p>

        <button
          onClick={handleLogin}
          disabled={loading}
          className={`flex items-center justify-center gap-3 w-full py-3 rounded-md font-medium transition ${
            loading
              ? ' btn-disabled'
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
        <FaMountain size={18} className='text-primary' />
          
        </>
        /* TODO: Google or Email later */
        /* <button className="mt-4 w-full bg-blue-600 text-white py-3 rounded-md">Login with Google</button> */
          )}
          
        <ConnectGarminLink></ConnectGarminLink>
          </button>
      </div>
    </div>
  );
}
