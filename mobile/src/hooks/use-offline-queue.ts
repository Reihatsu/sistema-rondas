/**
 * Hook de la cola offline.
 *
 * Filtra la cola global por el guardia autenticado: las marcaciones de una
 * sesión anterior permanecen en el dispositivo, pero no se muestran ni se
 * envían con otra cuenta.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useAuth } from '@/context/AuthContext';
import {
  discardFailedCheckIns,
  enqueueCheckIn,
  getOfflineQueueSnapshot,
  retryOfflineQueue,
  subscribeOfflineQueue,
  type EnqueueCheckInInput,
  type FlushOfflineQueueResult,
  type QueuedCheckIn,
} from '@/services/offlineQueue';

export type QueueCheckInInput = Omit<EnqueueCheckInInput, 'user_id'>;

export interface UseOfflineQueueResult {
  isHydrated: boolean;
  pendingItems: QueuedCheckIn[];
  failedItems: QueuedCheckIn[];
  pendingCount: number;
  failedCount: number;
  /** `false` solo cuando NetInfo confirma que no hay conexión. */
  isOnline: boolean;
  isSyncing: boolean;
  syncTotal: number;
  syncCompleted: number;
  lastSyncAt: string | null;
  lastError: string | null;
  lastFailedError: string | null;
  enqueue: (input: QueueCheckInInput) => Promise<QueuedCheckIn>;
  retry: () => Promise<FlushOfflineQueueResult>;
  discardFailed: () => Promise<number>;
}

const EMPTY_FLUSH_RESULT: FlushOfflineQueueResult = {
  synced: 0,
  failed: 0,
  remaining: 0,
};

export function useOfflineQueue(): UseOfflineQueueResult {
  const { user } = useAuth();
  const snapshot = useSyncExternalStore(
    subscribeOfflineQueue,
    getOfflineQueueSnapshot,
    getOfflineQueueSnapshot,
  );

  const userId = user?.id ?? null;
  const pendingItems = useMemo(
    () =>
      userId === null
        ? []
        : snapshot.items.filter(
            (item) => item.user_id === userId && item.status === 'pending',
          ),
    [snapshot.items, userId],
  );
  const failedItems = useMemo(
    () =>
      userId === null
        ? []
        : snapshot.items.filter(
            (item) => item.user_id === userId && item.status === 'failed',
          ),
    [snapshot.items, userId],
  );

  const lastFailedError =
    failedItems.length > 0
      ? (failedItems[failedItems.length - 1]?.last_error ?? null)
      : null;

  const enqueue = useCallback(
    async (input: QueueCheckInInput): Promise<QueuedCheckIn> => {
      if (userId === null) {
        throw new Error('Debe iniciar sesión para guardar una marcación.');
      }

      return enqueueCheckIn({ ...input, user_id: userId });
    },
    [userId],
  );

  const retry = useCallback(async (): Promise<FlushOfflineQueueResult> => {
    if (userId === null) {
      return EMPTY_FLUSH_RESULT;
    }

    return retryOfflineQueue(userId);
  }, [userId]);

  const discardFailed = useCallback(async (): Promise<number> => {
    if (userId === null) {
      return 0;
    }

    return discardFailedCheckIns(userId);
  }, [userId]);

  return {
    isHydrated: snapshot.isHydrated,
    pendingItems,
    failedItems,
    pendingCount: pendingItems.length,
    failedCount: failedItems.length,
    isOnline: snapshot.networkOnline !== false,
    isSyncing: snapshot.isSyncing,
    syncTotal: snapshot.syncTotal,
    syncCompleted: snapshot.syncCompleted,
    lastSyncAt: snapshot.lastSyncAt,
    lastError: snapshot.lastSyncError,
    lastFailedError,
    enqueue,
    retry,
    discardFailed,
  };
}
