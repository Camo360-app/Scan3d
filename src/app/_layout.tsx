import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0b1220' },
          headerTintColor: '#ffffff',
          contentStyle: { backgroundColor: '#0b1220' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Scan3D' }} />
        <Stack.Screen name="capture" options={{ title: 'Capture', headerBackTitle: 'Accueil' }} />
      </Stack>
    </>
  );
}
