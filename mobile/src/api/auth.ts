/**
 * Endpoints de autenticación (`/auth`).
 *
 * Importante: el backend (`app/api/v1/auth.py` + `app/schemas/auth.py`) espera
 * un **JSON** `{ "email": "...", "password": "..." }` en `/auth/login`. No usa
 * `OAuth2PasswordRequestForm`, así que enviar `application/x-www-form-urlencoded`
 * devolvería 422.
 */

import api from '@/api/client';
import type { LoginResponse, UserDetail } from '@/api/types';

/** `POST /auth/login`: valida credenciales y retorna el JWT. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

/**
 * `GET /auth/me`: perfil del usuario dueño del token, con sus empresas y
 * relaciones de supervisión. Útil para refrescar los datos cacheados.
 */
export async function getCurrentUser(): Promise<UserDetail> {
  const { data } = await api.get<UserDetail>('/auth/me');
  return data;
}

export const authApi = {
  login,
  me: getCurrentUser,
};
