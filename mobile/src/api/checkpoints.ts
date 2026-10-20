/**
 * Endpoints de Puntos de Control (`/checkpoints`).
 *
 * El backend restringe el acceso por rol: los guardias no pueden consultar la
 * configuración de puntos, por lo que estas llamadas son para supervisión.
 */

import api from '@/api/client';
import type { Checkpoint, Paginated } from '@/api/types';

export interface ListCheckpointsParams {
  page?: number;
  page_size?: number;
  /** Busca por nombre, código o descripción de ubicación. */
  search?: string;
  company_id?: number;
  is_active?: boolean;
}

/** `GET /checkpoints`: listado paginado según el alcance del usuario. */
export async function listCheckpoints(
  params: ListCheckpointsParams = {},
): Promise<Paginated<Checkpoint>> {
  const { data } = await api.get<Paginated<Checkpoint>>('/checkpoints', { params });
  return data;
}

/** `GET /checkpoints/{id}`: detalle de un punto de control. */
export async function getCheckpoint(checkpointId: number): Promise<Checkpoint> {
  const { data } = await api.get<Checkpoint>(`/checkpoints/${checkpointId}`);
  return data;
}

export const checkpointsApi = {
  list: listCheckpoints,
  get: getCheckpoint,
};
