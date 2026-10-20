/**
 * Sesión JWT de la aplicación.
 *
 * Responsabilidades:
 * - Restaurar la sesión persistida al arrancar (token + usuario).
 * - Exponer `login` y `logout`.
 * - Cerrar la sesión automáticamente si la API responde 401.
 *
 * La navegación no vive aquí: `AppNavigator` consume `isAuthenticated` para
 * decidir qué grupo de rutas mostrar.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { login as loginRequest } from '@/api/auth';
import { setUnauthorizedHandler } from '@/api/client';
import type { AuthUser, LoginResponse } from '@/api/types';
import { clearSession, getStoredUser, getToken, saveSession } from '@/services/storage';

export interface AuthContextValue {
  /** JWT actual; `null` cuando no hay sesión. */
  userToken: string | null;
  /** Datos del usuario autenticado (cacheados desde `/auth/login`). */
  user: AuthUser | null;
  /** Atajo booleano usado por el guard de navegación. */
  isAuthenticated: boolean;
  /** `true` mientras se lee la sesión de AsyncStorage al arrancar. */
  isLoading: boolean;
  /** Autentica contra FastAPI y persiste el token. */
  login: (email: string, password: string) => Promise<void>;
  /** Limpia el almacenamiento y el estado de sesión. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(async (): Promise<void> => {
    // El estado se limpia primero para que la UI reaccione de inmediato,
    // aunque el almacenamiento tarde o falle.
    setUserToken(null);
    setUser(null);

    try {
      await clearSession();
    } catch (error) {
      console.warn('[auth] No se pudo limpiar la sesión persistida:', error);
    }
  }, []);

  // Restaura la sesión guardada al iniciar la app.
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const [storedToken, storedUser] = await Promise.all([getToken(), getStoredUser()]);

        if (!isMounted) {
          return;
        }

        setUserToken(storedToken);
        setUser(storedUser);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  // Si el backend invalida el token (401), se cierra la sesión local.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [logout]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const session: LoginResponse = await loginRequest(email.trim().toLowerCase(), password);

    await saveSession(session.access_token, session.user);

    setUserToken(session.access_token);
    setUser(session.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      userToken,
      user,
      isAuthenticated: userToken !== null,
      isLoading,
      login,
      logout,
    }),
    [userToken, user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook de acceso a la sesión; falla si se usa fuera de `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth debe usarse dentro de un <AuthProvider>.');
  }

  return context;
}
