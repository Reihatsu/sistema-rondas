/**
 * Ruta pública `/login`.
 * El guard de `AppNavigator` solo la habilita cuando no hay token.
 */

import LoginScreen from '@/screens/LoginScreen';

export default function LoginRoute() {
  return <LoginScreen />;
}
