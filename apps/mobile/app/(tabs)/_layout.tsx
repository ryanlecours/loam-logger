import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2d5016',
        headerStyle: {
          backgroundColor: '#2d5016',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Rides',
          tabBarLabel: 'Rides',
        }}
      />
      <Tabs.Screen
        name="gear"
        options={{
          title: 'Gear',
          tabBarLabel: 'Gear',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
        }}
      />
    </Tabs>
  );
}
