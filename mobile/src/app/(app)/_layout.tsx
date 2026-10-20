/**
 * Layout del área autenticada (grupo `(app)`).
 * Todas las rutas hijas requieren token; el guard está en `AppNavigator`.
 */

import { Stack } from 'expo-router';

export default function AppGroupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
