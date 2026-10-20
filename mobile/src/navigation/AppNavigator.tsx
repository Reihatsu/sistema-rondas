/**
 * Navegación raíz de la app.
 *
 * Usa el `Stack` de Expo Router (basado en React Navigation native-stack) con
 * rutas protegidas: si hay token se muestra el grupo `(app)`; si no, `login`.
 * Al cambiar `isAuthenticated`, Expo Router redirige automáticamente al primer
 * grupo de rutas disponible, sin navegación imperativa.
 */

import { Stack } from 'expo-router';

import { useAuth } from '@/context/AuthContext';

export default function AppNavigator() {
  const { isAuthenticated } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
