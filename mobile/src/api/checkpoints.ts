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

/** Campos editables de un punto (`CheckpointCreate`/`CheckpointUpdate`). */
export interface CheckpointWritePayload {
  name: string;
  /** El servidor genera el siguiente código si se omite. */
  code?: string | null;
  /** UID opcional; en empresas QR el backend lo ignora. */
  uid_nfc?: string | null;
  location_description?: string | null;
  /** Coordenadas opcionales; solo aplican a puntos QR. */
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_m?: number;
  is_active?: boolean;
}

export interface CreateCheckpointPayload extends CheckpointWritePayload {
  company_id: number;
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

/** `POST /checkpoints`: alta de un punto de control. */
export async function createCheckpoint(
  payload: CreateCheckpointPayload,
): Promise<Checkpoint> {
  const { data } = await api.post<Checkpoint>('/checkpoints', payload);
  return data;
}

/** `PUT /checkpoints/{id}`: edición parcial de un punto de control. */
export async function updateCheckpoint(
  checkpointId: number,
  payload: Partial<CheckpointWritePayload> & { company_id?: number },
): Promise<Checkpoint> {
  const { data } = await api.put<Checkpoint>(`/checkpoints/${checkpointId}`, payload);
  return data;
}

export const checkpointsApi = {
  list: listCheckpoints,
  get: getCheckpoint,
  create: createCheckpoint,
  update: updateCheckpoint,
};
