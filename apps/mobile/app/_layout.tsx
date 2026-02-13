import { Slot, useRouter, useSegments } from 'expo-router';
import { ApolloProvider } from '@apollo/client';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';
import { client } from '../src/lib/apolloClient';
import { useEffect } from 'react';

function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#2d5016" />
    </View>
  );
}

function RootLayoutNav() {
  const {
    loading,
    isAuthenticated,
    hasAcceptedCurrentTerms,
    onboardingCompleted,
  } = useAuth();
  const segments = useSegments() as string[];
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const firstSegment = segments[0];
    const secondSegment = segments[1];
    const inAuthGroup = firstSegment === '(auth)';
    const inOnboardingGroup = firstSegment === '(onboarding)';

    // 1. AuthGate: Not authenticated -> login
    if (!isAuthenticated) {
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // User IS authenticated - don't let them stay in auth group
    if (inAuthGroup) {
      // Determine where they should go based on flags
      if (!hasAcceptedCurrentTerms) {
        router.replace('/(onboarding)/terms');
      } else if (!onboardingCompleted) {
        router.replace('/(onboarding)/age');
      } else {
        router.replace('/(tabs)');
      }
      return;
    }

    // 2. TermsGate: Authenticated but no terms -> terms screen
    if (!hasAcceptedCurrentTerms) {
      if (!inOnboardingGroup || secondSegment !== 'terms') {
        router.replace('/(onboarding)/terms');
      }
      return;
    }

    // 3. OnboardingGate: Terms accepted but onboarding incomplete -> onboarding
    if (!onboardingCompleted) {
      // Allow navigation within onboarding group (age, bike)
      // but not to terms (already accepted)
      if (!inOnboardingGroup) {
        router.replace('/(onboarding)/age');
      } else if (secondSegment === 'terms') {
        router.replace('/(onboarding)/age');
      }
      return;
    }

    // 4. Fully gated user - redirect to tabs if in onboarding
    if (inOnboardingGroup) {
      router.replace('/(tabs)');
    }
  }, [loading, isAuthenticated, hasAcceptedCurrentTerms, onboardingCompleted, segments, router]);

  // Show loading while auth initializes
  if (loading) {
    return <LoadingScreen />;
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});

export default function RootLayout() {
  return (
    <ApolloProvider client={client}>
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
    </ApolloProvider>
  );
}
