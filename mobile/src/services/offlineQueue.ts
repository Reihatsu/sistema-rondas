/**
 * Cola persistente de marcaciones realizadas sin conexión.
 *
 * Flujo:
 * 1. El escáner intenta enviar el check-in; si no hay red (o la API no es
 *    alcanzable), la marcación se guarda en AsyncStorage.
 * 2. `startOfflineQueueSync` escucha los cambios de red y, al recuperar la
 *    conexión, reenvía los elementos **en orden** y los elimina uno a uno.
 * 3. Los errores permanentes (p. ej. una geovalla inválida) se conservan
 *    marcados como `failed` para que el guardia pueda verlos y decidir.
 *
 * La cola incluye el `user_id` para que una marcación nunca se envíe con la
 * sesión de otro guardia que use el mismo dispositivo.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import axios from 'axios';
import { AppState, type AppStateStatus } from 'react-native';

import { getErrorMessage } from '@/api/client';
import { checkIn } from '@/api/rounds';
import { canonicalNfcText } from '@/services/nfcTag';
import { canonicalNfcUid } from '@/services/nfcUid';

export const OFFLINE_QUEUE_STORAGE_KEY = 'sistema-rondas.offline-queue.v1';

export type OfflineQueueItemStatus = 'pending' | 'failed';

/** Marcación pendiente de enviar al backend. */
export interface QueuedCheckIn {
  /** Identificador local e idempotente de la marcación. */
  id: string;
  /** Guardia propietario de la marcación. */
  user_id: number;
  round_id: number;
  /** `null` solo si el checkpoint no pudo resolverse desde la caché local. */
  checkpoint_id: number | null;
  checkpoint_name: string;
  /** Contenido leído del QR; `null` en las marcaciones NFC. */
  qr_code: string | null;
  /** Texto NDEF leído de la etiqueta NFC (código del punto); `null` en QR. */
  nfc_code: string | null;
  /** UID de la etiqueta NFC; `null` en las marcaciones QR. */
  nfc_uid: string | null;
  /** `null` en las marcaciones NFC sin GPS disponible. */
  latitude: number | null;
  longitude: number | null;
  /** Instante real de la marcación en el dispositivo (ISO 8601). */
  timestamp: string;
  /** Instante en que se encoló (ISO 8601). */
  queued_at: string;
  status: OfflineQueueItemStatus;
  attempts: number;
  last_error: string | null;
}

export interface EnqueueCheckInInput {
  user_id: number;
  round_id: number;
  checkpoint_id?: number | null;
  checkpoint_name?: string | null;
  /** Contenido del código QR. Obligatorio si no se envía `nfc_code`/`nfc_uid`. */
  qr_code?: string | null;
  /** Texto NDEF de la etiqueta NFC (código del punto). */
  nfc_code?: string | null;
  /** UID leído de la etiqueta NFC. Obligatorio si no hay `qr_code`/`nfc_code`. */
  nfc_uid?: string | null;
  /** Obligatoria para marcaciones QR; opcional para NFC. */
  latitude?: number | null;
  longitude?: number | null;
  /** Por defecto, el instante actual. */
  timestamp?: string;
}

export interface OfflineQueueSnapshot {
  /** `true` cuando ya se intentó leer AsyncStorage al menos una vez. */
  isHydrated: boolean;
  items: QueuedCheckIn[];
  /** `null` mientras NetInfo aún no ha emitido su primer estado. */
  networkOnline: boolean | null;
  isSyncing: boolean;
  syncTotal: number;
  syncCompleted: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface FlushOfflineQueueResult {
  synced: number;
  failed: number;
  remaining: number;
}

const initialSnapshot: OfflineQueueSnapshot = {
  isHydrated: false,
  items: [],
  networkOnline: null,
  isSyncing: false,
  syncTotal: 0,
  syncCompleted: 0,
  lastSyncAt: null,
  lastSyncError: null,
};

let snapshot: OfflineQueueSnapshot = initialSnapshot;
const listeners = new Set<() => void>();

function publish(patch: Partial<OfflineQueueSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

/** Suscripción usada por `useSyncExternalStore`. */
export function subscribeOfflineQueue(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Instantánea estable de la cola para React. */
export function getOfflineQueueSnapshot(): OfflineQueueSnapshot {
  return snapshot;
}

let hydration: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();

/**
 * Serializa las operaciones de lectura-modificación-escritura para que un
 * escaneo no sobrescriba una sincronización simultánea (o viceversa).
 */
function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const result = writeChain.then(task, task);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStoredItem(value: unknown): QueuedCheckIn | null {
  if (!isRecord(value)) {
    return null;
  }

  const userId = toFiniteNumber(value.user_id);
  const roundId = toFiniteNumber(value.round_id);
  const latitude = toFiniteNumber(value.latitude);
  const longitude = toFiniteNumber(value.longitude);
  const qrCode =
    typeof value.qr_code === 'string' ? value.qr_code.trim().toUpperCase() : '';
  const nfcCode = canonicalNfcText(
    typeof value.nfc_code === 'string' ? value.nfc_code : null,
  );
  const nfcUid = canonicalNfcUid(
    typeof value.nfc_uid === 'string' ? value.nfc_uid : null,
  );
  const hasCoordinates =
    latitude !== null && longitude !== null && isValidCoordinate(latitude, longitude);

  if (
    userId === null ||
    !Number.isInteger(userId) ||
    userId <= 0 ||
    roundId === null ||
    !Number.isInteger(roundId) ||
    roundId <= 0 ||
    (!qrCode && !nfcCode && !nfcUid) ||
    // El QR exige coordenadas (geovalla); el NFC puede marcarse sin GPS.
    (qrCode !== '' && !hasCoordinates)
  ) {
    return null;
  }

  const checkpointId = toFiniteNumber(value.checkpoint_id);
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : '';
  const queuedAt = typeof value.queued_at === 'string' ? value.queued_at : timestamp;
  const now = new Date().toISOString();

  return {
    id:
      typeof value.id === 'string' && value.id
        ? value.id
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    user_id: userId,
    round_id: roundId,
    checkpoint_id:
      checkpointId !== null && Number.isInteger(checkpointId) ? checkpointId : null,
    checkpoint_name:
      typeof value.checkpoint_name === 'string' && value.checkpoint_name.trim()
        ? value.checkpoint_name.trim()
        : qrCode || nfcCode || (nfcUid ? `NFC ${nfcUid}` : 'Punto de control'),
    qr_code: qrCode || null,
    nfc_code: nfcCode || null,
    nfc_uid: nfcUid || null,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    timestamp: timestamp || now,
    queued_at: queuedAt || now,
    status: value.status === 'failed' ? 'failed' : 'pending',
    attempts: Math.max(0, Math.trunc(toFiniteNumber(value.attempts) ?? 0)),
    last_error: typeof value.last_error === 'string' ? value.last_error : null,
  };
}

function parseStoredQueue(raw: string | null): QueuedCheckIn[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const source = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.items)
        ? parsed.items
        : [];

    return source
      .map(normalizeStoredItem)
      .filter((item): item is QueuedCheckIn => item !== null);
  } catch (error) {
    console.warn('[offlineQueue] La cola guardada no pudo leerse:', error);
    return [];
  }
}

async function persistItems(items: QueuedCheckIn[]): Promise<void> {
  await AsyncStorage.setItem(
    OFFLINE_QUEUE_STORAGE_KEY,
    JSON.stringify({ version: 1, items }),
  );
  publish({ items });
}

async function hydrateQueue(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    publish({ items: parseStoredQueue(raw), isHydrated: true });
  } catch (error) {
    // Sin almacenamiento la app sigue operando; solo se pierde la cola local.
    console.warn('[offlineQueue] No se pudo cargar la cola:', error);
    publish({ isHydrated: true });
  }
}

/** Carga la cola persistida una sola vez. */
export function initializeOfflineQueue(): Promise<void> {
  if (!hydration) {
    hydration = hydrateQueue();
  }

  return hydration;
}

function createLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Guarda una marcación en la cola local.
 *
 * Es idempotente por `user_id + round_id + identificador` (código QR, texto
 * NDEF o UID NFC): si el guardia vuelve a escanear el mismo punto sin conexión,
 * no se duplica el elemento.
 */
export async function enqueueCheckIn(
  input: EnqueueCheckInInput,
): Promise<QueuedCheckIn> {
  const qrCode =
    typeof input.qr_code === 'string' ? input.qr_code.trim().toUpperCase() : '';
  const nfcCode = canonicalNfcText(input.nfc_code);
  const nfcUid = canonicalNfcUid(input.nfc_uid);
  const latitude = typeof input.latitude === 'number' ? input.latitude : null;
  const longitude = typeof input.longitude === 'number' ? input.longitude : null;
  const hasCoordinates =
    latitude !== null && longitude !== null && isValidCoordinate(latitude, longitude);

  if (
    !Number.isInteger(input.user_id) ||
    input.user_id <= 0 ||
    !Number.isInteger(input.round_id) ||
    input.round_id <= 0 ||
    (!qrCode && !nfcCode && !nfcUid)
  ) {
    throw new Error('La marcación no tiene datos suficientes para guardarse.');
  }

  // El QR exige coordenadas para validar la geovalla; el NFC puede guardarse
  // sin GPS, pero si llegan coordenadas deben ser válidas.
  const coordinatesSent = latitude !== null || longitude !== null;

  if ((qrCode && !hasCoordinates) || (!qrCode && coordinatesSent && !hasCoordinates)) {
    throw new Error('La ubicación capturada no es válida para guardar la marcación.');
  }

  const checkpointId =
    typeof input.checkpoint_id === 'number' &&
    Number.isInteger(input.checkpoint_id) &&
    input.checkpoint_id > 0
      ? input.checkpoint_id
      : null;

  await initializeOfflineQueue();

  const now = new Date().toISOString();
  const parsedTimestamp = input.timestamp ? new Date(input.timestamp) : null;
  const timestamp =
    parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
      ? parsedTimestamp.toISOString()
      : now;

  return withQueueLock(async () => {
    const existing = snapshot.items.find(
      (item) =>
        item.user_id === input.user_id &&
        item.round_id === input.round_id &&
        (qrCode !== ''
          ? item.qr_code === qrCode
          : nfcCode !== ''
            ? item.nfc_code === nfcCode ||
              (nfcUid !== '' && item.nfc_uid === nfcUid)
            : item.nfc_uid === nfcUid),
    );

    if (existing) {
      // Si el intento anterior fue rechazado, un nuevo escaneo lo devuelve a
      // pendiente con la ubicación y hora actuales.
      if (existing.status === 'failed') {
        const retried: QueuedCheckIn = {
          ...existing,
          checkpoint_id: checkpointId ?? existing.checkpoint_id,
          checkpoint_name:
            input.checkpoint_name?.trim() || existing.checkpoint_name,
          latitude: hasCoordinates ? latitude : null,
          longitude: hasCoordinates ? longitude : null,
          timestamp,
          queued_at: now,
          status: 'pending',
          last_error: null,
        };

        await persistItems(
          snapshot.items.map((item) => (item.id === existing.id ? retried : item)),
        );

        return retried;
      }

      return existing;
    }

    const item: QueuedCheckIn = {
      id: createLocalId(),
      user_id: input.user_id,
      round_id: input.round_id,
      checkpoint_id: checkpointId,
      checkpoint_name:
        input.checkpoint_name?.trim() ||
        qrCode ||
        nfcCode ||
        (nfcUid ? `NFC ${nfcUid}` : 'Punto de control'),
      qr_code: qrCode || null,
      nfc_code: nfcCode || null,
      nfc_uid: nfcUid || null,
      latitude: hasCoordinates ? latitude : null,
      longitude: hasCoordinates ? longitude : null,
      timestamp,
      queued_at: now,
      status: 'pending',
      attempts: 0,
      last_error: null,
    };

    await persistItems([...snapshot.items, item]);

    return item;
  });
}

async function removeItemById(userId: number, itemId: string): Promise<void> {
  await withQueueLock(async () => {
    const items = snapshot.items.filter(
      (item) => !(item.user_id === userId && item.id === itemId),
    );

    if (items.length !== snapshot.items.length) {
      await persistItems(items);
    }
  });
}

async function markItemFailed(
  userId: number,
  itemId: string,
  message: string,
): Promise<void> {
  await withQueueLock(async () => {
    let changed = false;

    const items = snapshot.items.map((item) => {
      if (item.user_id !== userId || item.id !== itemId) {
        return item;
      }

      changed = true;
      return {
        ...item,
        status: 'failed' as const,
        attempts: item.attempts + 1,
        last_error: message,
      };
    });

    if (changed) {
      await persistItems(items);
    }
  });
}

function isNetworkOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

function getResponseStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}

/**
 * Errores que conviene reintentar: falta de red, timeouts, límites temporales
 * y caídas del servidor. Los errores de validación (4xx) no entran aquí.
 */
export function isNetworkRequestError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return error.code !== 'ERR_CANCELED';
  }

  const status = error.response.status;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isDuplicateCheckInError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) {
    return false;
  }

  const detail: unknown = error.response.data?.detail;
  return typeof detail === 'string' && /ya registró el punto/i.test(detail);
}

/** Devuelve los elementos `failed` a `pending` antes de un reintento manual. */
export async function resetFailedCheckIns(userId: number): Promise<number> {
  await initializeOfflineQueue();

  return withQueueLock(async () => {
    let resetCount = 0;

    const items = snapshot.items.map((item) => {
      if (item.user_id !== userId || item.status !== 'failed') {
        return item;
      }

      resetCount += 1;
      return {
        ...item,
        status: 'pending' as const,
        last_error: null,
      };
    });

    if (resetCount > 0) {
      await persistItems(items);
    }

    return resetCount;
  });
}

/** Descarta las marcaciones que el servidor rechazó de forma definitiva. */
export async function discardFailedCheckIns(userId: number): Promise<number> {
  await initializeOfflineQueue();

  return withQueueLock(async () => {
    const items = snapshot.items.filter(
      (item) => !(item.user_id === userId && item.status === 'failed'),
    );
    const removed = snapshot.items.length - items.length;

    if (removed > 0) {
      await persistItems(items);
    }

    return removed;
  });
}

interface ActiveFlush {
  userId: number;
  promise: Promise<FlushOfflineQueueResult>;
}

let activeFlush: ActiveFlush | null = null;

async function runFlush(userId: number): Promise<FlushOfflineQueueResult> {
  await initializeOfflineQueue();

  let networkState: NetInfoState | null = null;

  try {
    networkState = await NetInfo.fetch();
  } catch (error) {
    console.warn('[offlineQueue] No se pudo consultar el estado de red:', error);
  }

  if (networkState) {
    const online = isNetworkOnline(networkState);
    publish({ networkOnline: online });

    if (!online) {
      return {
        synced: 0,
        failed: 0,
        remaining: snapshot.items.filter(
          (item) => item.user_id === userId && item.status === 'pending',
        ).length,
      };
    }
  } else if (snapshot.networkOnline === false) {
    return {
      synced: 0,
      failed: 0,
      remaining: snapshot.items.filter(
        (item) => item.user_id === userId && item.status === 'pending',
      ).length,
    };
  }

  const pending = snapshot.items
    .filter((item) => item.user_id === userId && item.status === 'pending')
    .sort(
      (first, second) =>
        first.timestamp.localeCompare(second.timestamp) ||
        first.queued_at.localeCompare(second.queued_at),
    );

  if (pending.length === 0) {
    publish({ isSyncing: false, syncTotal: 0, syncCompleted: 0 });
    return { synced: 0, failed: 0, remaining: 0 };
  }

  publish({
    isSyncing: true,
    syncTotal: pending.length,
    syncCompleted: 0,
    lastSyncError: null,
  });

  let synced = 0;
  let failed = 0;
  let processed = 0;

  for (const candidate of pending) {
    const current = snapshot.items.find(
      (item) =>
        item.user_id === userId &&
        item.id === candidate.id &&
        item.status === 'pending',
    );

    if (!current) {
      continue;
    }

    try {
      await checkIn(current.round_id, {
        qr_code: current.qr_code ?? undefined,
        nfc_code: current.nfc_code ?? undefined,
        nfc_uid: current.nfc_uid ?? undefined,
        latitude: current.latitude,
        longitude: current.longitude,
        timestamp: current.timestamp,
      });

      synced += 1;
      processed += 1;

      try {
        await removeItemById(userId, current.id);
      } catch (storageError) {
        console.warn('[offlineQueue] No se pudo quitar la marcación sincronizada:', storageError);
        publish({
          lastSyncError:
            'La marcación llegó al servidor, pero no se pudo actualizar la cola local. Se reintentará sin duplicarla.',
        });
      }

      publish({ syncCompleted: processed });
      continue;
    } catch (error) {
      // La red se perdió otra vez: se detiene el lote y se conserva el resto.
      if (isNetworkRequestError(error)) {
        publish({ lastSyncError: getErrorMessage(error) });
        break;
      }

      // Un 401 ya lo gestiona el cliente HTTP cerrando la sesión. La cola se
      // conserva para que se envíe al volver a iniciar sesión.
      if (getResponseStatus(error) === 401) {
        publish({
          lastSyncError:
            'La sesión expiró. Inicie sesión de nuevo para sincronizar sus marcaciones.',
        });
        break;
      }

      // Una marcación que ya llegó al servidor (respuesta perdida o reintento
      // del guardia) se considera sincronizada, no un error pendiente.
      if (isDuplicateCheckInError(error)) {
        synced += 1;
        processed += 1;

        try {
          await removeItemById(userId, current.id);
        } catch (storageError) {
          console.warn('[offlineQueue] No se pudo quitar el duplicado:', storageError);
        }

        publish({ syncCompleted: processed });
        continue;
      }

      // Error de negocio: se conserva para que el guardia vea el motivo, pero
      // no se reintenta automáticamente en cada cambio de red.
      const message = getErrorMessage(error);

      try {
        await markItemFailed(userId, current.id, message);
      } catch (storageError) {
        console.warn('[offlineQueue] No se pudo marcar la marcación con error:', storageError);
      }

      failed += 1;
      processed += 1;
      publish({ syncCompleted: processed });
    }
  }

  publish({
    isSyncing: false,
    syncCompleted: processed,
    lastSyncAt:
      processed > 0 ? new Date().toISOString() : snapshot.lastSyncAt,
  });

  return {
    synced,
    failed,
    remaining: snapshot.items.filter(
      (item) => item.user_id === userId && item.status === 'pending',
    ).length,
  };
}

/** Envía la cola pendiente de un guardia. Nunca ejecuta dos lotes a la vez. */
export function flushOfflineQueue(userId: number): Promise<FlushOfflineQueueResult> {
  if (activeFlush) {
    if (activeFlush.userId === userId) {
      return activeFlush.promise;
    }

    // Cambio de sesión durante un envío: el nuevo guardia espera a que termine
    // el lote anterior y luego procesa el suyo.
    return activeFlush.promise.then(
      () => flushOfflineQueue(userId),
      () => flushOfflineQueue(userId),
    );
  }

  const promise = runFlush(userId)
    .catch((error: unknown) => {
      // Una excepción inesperada no debe dejar el banner girando ni perder la
      // cola: se conserva todo y se informa del fallo.
      publish({ isSyncing: false, lastSyncError: getErrorMessage(error) });

      return {
        synced: 0,
        failed: 0,
        remaining: snapshot.items.filter(
          (item) => item.user_id === userId && item.status === 'pending',
        ).length,
      };
    })
    .finally(() => {
      if (activeFlush?.promise === promise) {
        activeFlush = null;
      }
    });

  activeFlush = { userId, promise };

  return promise;
}

/** Reintenta también las marcaciones rechazadas por el servidor. */
export async function retryOfflineQueue(
  userId: number,
): Promise<FlushOfflineQueueResult> {
  await resetFailedCheckIns(userId);
  return flushOfflineQueue(userId);
}

/**
 * Activa la sincronización automática para el guardia indicado.
 *
 * Se llama al iniciar sesión y devuelve la función de limpieza para el
 * `useEffect` del gestor global. También reintenta al volver del segundo plano,
 * un caso habitual en dispositivos que suspenden la app durante el recorrido.
 */
export function startOfflineQueueSync(userId: number): () => void {
  void initializeOfflineQueue();

  const handleNetworkState = (state: NetInfoState): void => {
    const online = isNetworkOnline(state);
    publish({ networkOnline: online });

    if (online) {
      void flushOfflineQueue(userId);
    }
  };

  // El listener emite el estado actual inmediatamente en NetInfo 12.
  const unsubscribeNetInfo = NetInfo.addEventListener(handleNetworkState);

  const appStateSubscription = AppState.addEventListener(
    'change',
    (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        return;
      }

      void NetInfo.fetch()
        .then(handleNetworkState)
        .catch(() => {
          // Si NetInfo no responde, se intenta el envío igualmente: el error
          // de red se gestionará dentro del lote sin perder la cola.
          void flushOfflineQueue(userId);
        });
    },
  );

  return () => {
    unsubscribeNetInfo();
    appStateSubscription.remove();
  };
}
