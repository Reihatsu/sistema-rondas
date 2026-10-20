/**
 * Punto de entrada de la app (equivalente al `App.js` de una app clásica).
 *
 * Con Expo Router la raíz es este layout: aquí se montan los providers
 * (`AuthProvider` para la sesión JWT y `ThemeProvider` para el tema) y el
 * navegador con las rutas protegidas (`AppNavigator`).
 */

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import AppNavigator from '@/navigation/AppNavigator';

void SplashScreen.preventAutoHideAsync();

/**
 * Se monta cuando la sesión persistida ya se leyó de AsyncStorage. Mientras
 * `isLoading` es `true` se devuelve `null` y el splash nativo sigue visible,
 * evitando mostrar el login a un usuario que ya tenía sesión.
 */
function RootLayoutContent() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  return (
    <>
      <AnimatedSplashOverlay />
      <AppNavigator />
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RootLayoutContent />
      </ThemeProvider>
    </AuthProvider>
  );
}
