import { useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import ConnectGarminLink from '../components/ConnectGarminLink';
import { ME_QUERY } from '../graphql/me';
import { useRedirectFrom } from '../utils/loginUtils';
import { Button } from '@/components/ui';

export default function Login() {
  const apollo = useApolloClient();
  const navigate = useNavigate();
  const from = useRedirectFrom();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleLoginSuccess(resp: CredentialResponse) {
    const credential = resp.credential;
    if (!credential) {
      console.error('[GoogleLogin] Missing credential in response', resp);
      alert('Google login did not return a valid credential.');
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/google/code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('[GoogleLogin] Backend responded with error', res.status, text);
        alert(`Login failed: ${res.statusText}`);
        return;
      }

      const { data } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
      apollo.writeQuery({ query: ME_QUERY, data });
      navigate(from, { replace: true });
    } catch (err) {
      console.error('[GoogleLogin] Network or unexpected error', err);
      alert('A network error occurred during login. Please try again.');
    }
  }

  function handleLoginError() {
    console.error('[GoogleLogin] Google login widget reported error');
    alert('Google login failed. Please try again.');
  }

  function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    alert('Manual authentication will be available soon.');
  }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(0,60,30,0.6),_transparent),radial-gradient(circle_at_bottom,_rgba(0,20,10,0.8),_rgb(6,8,6))] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[32px] panel-soft shadow-soft border border-app/80 p-8 space-y-6">
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-[0.4em] text-muted">Loam Logger</p>
          <h1 className="text-2xl font-semibold text-white">Track your rides, maintain your bike</h1>
          <p className="text-sm text-muted">Sign in to sync rides, gear hours, and service logs.</p>
        </div>

        <div className="flex rounded-full border border-app p-1">
          <button
            type="button"
            className={`flex-1 rounded-full px-4 cursor-pointer py-2 text-sm font-semibold transition ${
              mode === 'login' ? 'btn-primary' : 'btn-outline text-accent-contrast hover:text-white hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1'
            }`}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={`flex-1 rounded-full px-4 py-2 cursor-pointer text-sm font-semibold transition ${
              mode === 'signup' ? 'btn-primary' : 'btn-outline hover:text-white hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1'
            }`}
            onClick={() => setMode('signup')}
          >
            Sign Up
          </button>
        </div>

        <form className="space-y-4 bg-surface p-4 rounded-xl" onSubmit={handleManualSubmit}>
          <label className="block text-xs uppercase tracking-[0.3em] text-muted">
            Email
            <input
              type="email"
              className="mt-1 w-full input-soft"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.3em] text-muted">
            Password
            <input
              type="password"
              className="mt-1 w-full input-soft"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          <Button type="submit" variant="primary" className="w-full justify-center text-base">
            {mode === 'login' ? 'Login' : 'Create Account'}
          </Button>
        </form>

        <div className="space-y-3 bg-surface p-4 rounded-xl">
          <div className="text-center text-xs uppercase tracking-[0.3em] text-muted">Or continue with</div>
          <div className="flex flex-col gap-3">
            <div className="flex justify-center">
              <GoogleLogin
                useOneTap
                onSuccess={handleLoginSuccess}
                onError={handleLoginError}
                shape="pill"
                theme="filled_black"
                size="large"
                width="260"
              />
            </div>
            <div className="rounded-2xl border border-app/60 bg-surface-2/70 px-4 py-3">
              <ConnectGarminLink />
            </div>
          </div>
        </div>

        <Button
          variant="secondary"
          onClick={() => navigate('/')}
          className="w-full justify-center text-sm"
          type="button"
        >
          ← Back to site
        </Button>
      </div>
    </div>
  );
}
