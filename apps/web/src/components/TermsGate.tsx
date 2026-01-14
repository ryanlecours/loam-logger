import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';

export default function TermsGate({ children }: { children: ReactNode }) {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted">Loading...</div>
        </div>
      </div>
    );
  }

  // If user hasn't accepted current terms, redirect to onboarding step 1 (Terms)
  if (user && !user.hasAcceptedCurrentTerms) {
    return <Navigate to="/onboarding?step=1" replace />;
  }

  return <>{children}</>;
}
