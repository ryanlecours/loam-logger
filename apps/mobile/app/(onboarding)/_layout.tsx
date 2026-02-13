import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false, // Prevent swipe-back through gates
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="terms" options={{ gestureEnabled: false }} />
      <Stack.Screen name="age" options={{ gestureEnabled: false }} />
      <Stack.Screen name="bike" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
