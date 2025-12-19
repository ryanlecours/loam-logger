import { useEffect } from 'react';
import { useApolloClient } from '@apollo/client';
import { useNavigate } from 'react-router-dom';

export default function AuthComplete() {
  const client = useApolloClient();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // reload user & any cached queries that depend on it
      await client.refetchQueries({ include: 'active' }).catch(() => {});
      // short pause for UX, then go to dashboard
      setTimeout(() => navigate('/dashboard', { replace: true }), 600);
    })();
  }, [client, navigate]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl mb-2">Connected!</h1>
      <p>Finishing setup…</p>
    </div>
  );
}
