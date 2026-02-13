import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';
import { getAccessToken } from '../../src/lib/auth';

export default function BikeScreen() {
  const { refetchUser } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

      // Call REST endpoint to complete onboarding
      const response = await fetch(`${apiUrl}/onboarding/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          // Placeholder data - actual bike form will be in MOB-09/MOB-10
          age: 25,
          location: 'Test Location',
          bikeYear: 2024,
          bikeMake: 'Test',
          bikeModel: 'Bike',
          components: {},
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to complete onboarding');
      }

      // Refetch user to update onboardingCompleted flag
      // Root layout will handle navigation to tabs
      await refetchUser();
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to complete onboarding'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Add Your Bike</Text>
        <Text style={styles.subtitle}>Tell us about your primary bike</Text>

        {/* Placeholder - actual bike search will be added in MOB-09 */}
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>[Bike search placeholder]</Text>
          <Text style={styles.placeholderHint}>
            99Spokes search will be implemented in MOB-09
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleComplete}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Complete Onboarding</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#2d5016',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    color: '#666',
    marginBottom: 32,
  },
  placeholder: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 24,
    marginBottom: 24,
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: '#999',
    marginBottom: 8,
  },
  placeholderHint: {
    fontSize: 12,
    color: '#bbb',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2d5016',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
