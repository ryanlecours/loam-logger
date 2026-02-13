import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { useApolloClient } from '@apollo/client';
import type { UserRole } from '@loam/graphql';
import {
  getAccessToken,
  logout as logoutAuth,
  setTokenRefreshCallback,
  type User,
} from '../lib/auth';
import { useViewer } from './useViewer';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  // Gating flags (derived from user for convenience)
  hasAcceptedCurrentTerms: boolean;
  onboardingCompleted: boolean;
  role: UserRole | null;
  mustChangePassword: boolean;
  // Actions
  setUser: (user: User | null) => void;
  setAuthenticated: (authenticated: boolean) => void;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const client = useApolloClient();
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Use ME query to fetch full user data when authenticated
  const { viewer, loading: viewerLoading, error: viewerError, refetchViewer } = useViewer({
    skip: !isAuthenticated,
  });

  // Check for existing token on mount
  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const token = await getAccessToken();
      if (token) {
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('Failed to check auth:', error);
    } finally {
      setInitializing(false);
    }
  }

  // When viewer data arrives from ME query, update user state
  useEffect(() => {
    if (viewer) {
      // Map ME query response to User type
      const mappedUser: User = {
        id: viewer.id,
        email: viewer.email,
        name: viewer.name,
        avatarUrl: viewer.avatarUrl,
        onboardingCompleted: viewer.onboardingCompleted,
        hasAcceptedCurrentTerms: viewer.hasAcceptedCurrentTerms,
        role: viewer.role,
        mustChangePassword: viewer.mustChangePassword,
        isFoundingRider: viewer.isFoundingRider,
        hoursDisplayPreference: viewer.hoursDisplayPreference,
        predictionMode: viewer.predictionMode,
        createdAt: viewer.createdAt,
      };
      setUser(mappedUser);

      if (__DEV__) {
        console.log('[useAuth] ME query resolved:', {
          id: mappedUser.id,
          email: mappedUser.email,
          hasAcceptedCurrentTerms: mappedUser.hasAcceptedCurrentTerms,
          onboardingCompleted: mappedUser.onboardingCompleted,
          role: mappedUser.role,
        });
      }
    }
  }, [viewer]);

  // Handle ME query errors - if the query fails, log out the user
  // This handles cases like invalid/expired tokens that can't be refreshed
  useEffect(() => {
    if (viewerError && !viewerLoading && isAuthenticated) {
      console.error('[useAuth] ME query error:', viewerError.message);
      // Token is likely invalid - clear auth state
      logout();
    }
  }, [viewerError, viewerLoading, isAuthenticated]);

  // Register token refresh callback to refetch user when token is refreshed
  const refetchUser = useCallback(async () => {
    try {
      await refetchViewer();
    } catch (error) {
      console.error('Failed to refetch user:', error);
    }
  }, [refetchViewer]);

  useEffect(() => {
    setTokenRefreshCallback(() => {
      if (__DEV__) {
        console.log('[useAuth] Token refreshed, refetching user...');
      }
      refetchUser();
    });
    return () => setTokenRefreshCallback(null);
  }, [refetchUser]);

  async function logout() {
    await logoutAuth();
    await client.clearStore(); // Clear Apollo cache
    setUser(null);
    setIsAuthenticated(false);
    if (__DEV__) {
      console.log('[useAuth] Logged out, cleared tokens and Apollo cache');
    }
  }

  // Loading is true while initializing OR while fetching viewer after auth
  const loading = initializing || (isAuthenticated && viewerLoading && !user);

  // Derive gating flags from user
  const hasAcceptedCurrentTerms = user?.hasAcceptedCurrentTerms ?? false;
  const onboardingCompleted = user?.onboardingCompleted ?? false;
  const role = user?.role ?? null;
  const mustChangePassword = user?.mustChangePassword ?? false;

  // Allow login screens to trigger authentication state change
  const setAuthenticated = useCallback((authenticated: boolean) => {
    setIsAuthenticated(authenticated);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated,
        hasAcceptedCurrentTerms,
        onboardingCompleted,
        role,
        mustChangePassword,
        setUser,
        setAuthenticated,
        logout,
        refetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
