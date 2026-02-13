import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function AgeScreen() {
  const router = useRouter();

  function handleContinue() {
    router.replace('/(onboarding)/bike');
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>How old are you?</Text>
        <Text style={styles.subtitle}>
          You must be at least 16 to use Loam Logger
        </Text>

        {/* Placeholder - actual age input will be added in MOB-08 */}
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>[Age input placeholder]</Text>
          <Text style={styles.placeholderHint}>
            Age validation will be implemented in MOB-08
          </Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleContinue}>
          <Text style={styles.buttonText}>Continue</Text>
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
    minHeight: 120,
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
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
