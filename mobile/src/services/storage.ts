/**
 * Persistencia local de la sesión (token JWT y usuario).
 *
 * Usa AsyncStorage, que es **no cifrado**. Para producción con datos
 * sensibles se recomienda migrar el token a `expo-secure-store`; el resto de
 * la app solo depende de estas funciones, así que el cambio queda aislado.
 *
 * Los nombres de clave coinciden con el frontend web para mantener el mismo
 * contrato entre clientes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthUser } from '@/api/types';

export const TOKEN_STORAGE_KEY = 'sistema-rondas.token';
export const USER_STORAGE_KEY = 'sistema-rondas.user';

/** Devuelve el token guardado o `null` si no existe. */
export async function getToken(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token || token.trim().length === 0) {
      return null;
    }
    return token;
  } catch (error) {
    // Un fallo de almacenamiento no debe romper la app: se trata como
    // "sin sesión" y se deja rastro para depuración.
    console.warn('[storage] No se pudo leer el token:', error);
    return null;
  }
}

/** Devuelve el usuario cacheado o `null` si no hay sesión válida. */
export async function getStoredUser(): Promise<AuthUser | null> {
  try {
    const rawUser = await AsyncStorage.getItem(USER_STORAGE_KEY);
    if (!rawUser) {
      return null;
    }
    return JSON.parse(rawUser) as AuthUser;
  } catch (error) {
    console.warn('[storage] No se pudo leer el usuario:', error);
    return null;
  }
}

/** Guarda el token y (si se conoce) los datos del usuario autenticado. */
export async function saveSession(token: string, user: AuthUser | null): Promise<void> {
  const entries: [string, string][] = [[TOKEN_STORAGE_KEY, token]];

  if (user) {
    entries.push([USER_STORAGE_KEY, JSON.stringify(user)]);
  }

  await AsyncStorage.multiSet(entries);

  // Si no se recibió el usuario, se elimina el valor anterior para no mostrar
  // datos de una sesión previa.
  if (!user) {
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  }
}

/** Borra por completo la sesión persistida. */
export async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_STORAGE_KEY, USER_STORAGE_KEY]);
}
