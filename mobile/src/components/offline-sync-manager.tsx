/**
 * Puente entre la sesión autenticada y la cola offline.
 *
 * Se monta una sola vez en el layout raíz. No renderiza nada: carga la cola
 * persistida y activa el listener de red mientras haya un guardia autenticado.
 */

import { useEffect } from 'react';

import { useAuth } from '@/context/AuthContext';
import {
  initializeOfflineQueue,
  startOfflineQueueSync,
} from '@/services/offlineQueue';

export function OfflineSyncManager() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    void initializeOfflineQueue();
  }, []);

  useEffect(() => {
    if (!userId || userId <= 0) {
      return;
    }

    return startOfflineQueueSync(userId);
  }, [userId]);

  return null;
}
