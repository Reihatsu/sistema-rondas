/**
 * Cliente HTTP único de la aplicación (Axios).
 *
 * Se encarga de:
 * 1. Apuntar a la URL base de FastAPI.
 * 2. Adjuntar el JWT (`Authorization: Bearer <token>`) en cada petición.
 * 3. Avisar a la capa de sesión cuando la API responde 401.
 */

import axios from 'axios';

import { getToken } from '@/services/storage';

/**
 * URL base del backend FastAPI, **con** el prefijo de versión de la API.
 *
 * Se puede sobrescribir con la variable de entorno `EXPO_PUBLIC_API_URL`
 * (archivo `.env` en la raíz de `mobile/`), por ejemplo:
 *
 *   EXPO_PUBLIC_API_URL=https://sistema-rondas.onrender.com/api/v1
 *
 * Referencias para desarrollo local:
 * - Emulador Android: `http://10.0.2.2:8000/api/v1`
 * - Dispositivo físico: `http://<IP-LAN-del-PC>:8000/api/v1`
 */
export const DEFAULT_BASE_URL = 'http://localhost:8000/api/v1';

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

/** Valida y normaliza la URL base (sin barra final, nunca relativa). */
function resolveBaseUrl(rawBaseUrl: string | undefined): string {
  const value = typeof rawBaseUrl === 'string' ? rawBaseUrl.trim() : '';

  if (!value) {
    return DEFAULT_BASE_URL;
  }

  if (!ABSOLUTE_URL_PATTERN.test(value)) {
    console.warn(
      `[api] Se ignora EXPO_PUBLIC_API_URL="${value}": debe ser una URL absoluta (http:// o https://).`,
    );
    return DEFAULT_BASE_URL;
  }

  return value.replace(/\/+$/, '');
}

export const BASE_URL = resolveBaseUrl(process.env.EXPO_PUBLIC_API_URL);

/** Instancia de Axios compartida por todos los módulos de `src/api`. */
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Callback registrado por `AuthProvider` para cerrar la sesión local cuando
 * el backend responde 401 (token caducado, revocado o inválido).
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// Request interceptor: lee el JWT de AsyncStorage y lo adjunta al header.
api.interceptors.request.use(async (config) => {
  const token = await getToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Response interceptor: un 401 fuera del login invalida la sesión guardada.
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const isUnauthorized =
      axios.isAxiosError(error) && error.response?.status === 401;

    // El propio login devuelve 401 con credenciales incorrectas: en ese caso
    // no hay ninguna sesión que cerrar.
    const isLoginRequest = axios.isAxiosError(error)
      ? (error.config?.url ?? '').includes('/auth/login')
      : false;

    if (isUnauthorized && !isLoginRequest) {
      unauthorizedHandler?.();
    }

    return Promise.reject(error);
  },
);

interface FastApiValidationError {
  loc?: (string | number)[];
  msg?: string;
}

/**
 * Extrae un mensaje legible de un error de Axios o de FastAPI,
 * incluyendo los errores de validación 422.
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail: unknown = error.response?.data?.detail;

    if (typeof detail === 'string') {
      return detail;
    }

    if (Array.isArray(detail)) {
      const messages = (detail as FastApiValidationError[]).map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
        const message = item.msg ?? 'Valor inválido';
        return field ? `${field}: ${message}` : message;
      });

      if (messages.length > 0) {
        return messages.join('. ');
      }
    }

    if (error.code === 'ECONNABORTED') {
      return 'La petición tardó demasiado. Inténtelo de nuevo.';
    }

    if (!error.response) {
      return 'No se pudo conectar con el servidor. Verifique su conexión y que la API esté disponible.';
    }

    return error.message || 'Se produjo un error inesperado.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Se produjo un error inesperado.';
}

export default api;
