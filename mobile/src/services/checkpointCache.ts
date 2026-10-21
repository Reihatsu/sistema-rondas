/**
 * Caché local de los checkpoints de una ronda.
 *
 * El escáner necesita traducir el código QR a `checkpoint_id` para poder
 * guardar la marcación offline. `listRoundCheckpoints` requiere red, así que
 * `RondasScreen` guarda una copia compacta y el escáner la usa como respaldo.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RoundCheckpoint } from '@/api/types';

const STORAGE_KEY_PREFIX = 'sistema-rondas.round-checkpoints.v1.';

export interface CachedRoundCheckpoint {
  id: number;
  name: string;
  code: string;
}

function getStorageKey(roundId: number): string {
  return `${STORAGE_KEY_PREFIX}${roundId}`;
}

function toCachedCheckpoint(value: unknown): CachedRoundCheckpoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = Number(record.id);
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.code === 'string' ? record.code : '';

  if (!Number.isInteger(id) || id <= 0 || !code.trim()) {
    return null;
  }

  return { id, name: name || code, code: code.trim().toUpperCase() };
}

/** Guarda los puntos de la ronda para futuras marcaciones sin conexión. */
export async function cacheRoundCheckpoints(
  roundId: number,
  checkpoints: RoundCheckpoint[],
): Promise<void> {
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return;
  }

  const payload: CachedRoundCheckpoint[] = checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    name: checkpoint.name,
    code: checkpoint.code.trim().toUpperCase(),
  }));

  try {
    await AsyncStorage.setItem(
      getStorageKey(roundId),
      JSON.stringify({ saved_at: new Date().toISOString(), checkpoints: payload }),
    );
  } catch (error) {
    // La caché es una optimización: un fallo no debe afectar al escaneo.
    console.warn('[checkpointCache] No se pudieron guardar los checkpoints:', error);
  }
}

/** Recupera la última copia conocida de los puntos de una ronda. */
export async function getCachedRoundCheckpoints(
  roundId: number,
): Promise<CachedRoundCheckpoint[]> {
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return [];
  }

  try {
    const raw = await AsyncStorage.getItem(getStorageKey(roundId));

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      return [];
    }

    const source = (parsed as { checkpoints?: unknown }).checkpoints;

    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .map(toCachedCheckpoint)
      .filter((item): item is CachedRoundCheckpoint => item !== null);
  } catch (error) {
    console.warn('[checkpointCache] No se pudieron leer los checkpoints:', error);
    return [];
  }
}
