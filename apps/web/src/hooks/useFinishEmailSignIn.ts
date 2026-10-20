import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useApolloClient } from '@apollo/client';
import { ME_QUERY } from '../graphql/me';
import { setCsrfToken } from '@/lib/csrf';
import type { EmailSignedIn } from './useEmailSignInPoll';

/**
 * Finish a sign-in made with an email sign-in grant, the same way a password
 * sign-in finishes: cache the CSRF token, load the viewer, and go in. The
 * dashboard's gates send a new account on to terms and onboarding.
 */
export function useFinishEmailSignIn(destination = '/dashboard') {
  const apollo = useApolloClient();
  const navigate = useNavigate();

  return useCallback(
    async (result: EmailSignedIn) => {
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      if (result.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }
      try {
        const { data } = await apollo.query({ query: ME_QUERY, fetchPolicy: 'network-only' });
        apollo.writeQuery({ query: ME_QUERY, data });
      } catch {
        // The session cookie is set either way; the destination's AuthGate
        // loads the viewer itself.
      }
      navigate(destination, { replace: true });
    },
    [apollo, navigate, destination],
  );
}
