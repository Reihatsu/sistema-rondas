/**
 * Endpoints de Rondas (`/rounds`).
 *
 * Un guardia autenticado solo recibe sus propias rondas: el backend aplica el
 * alcance por rol en cada consulta.
 */

import api from '@/api/client';
import type {
  CheckInPayload,
  CheckInResult,
  Paginated,
  Round,
  RoundCheckpoint,
  RoundDetail,
  RoundLog,
  RoundStatus,
  RoundSummary,
} from '@/api/types';

export interface ListRoundsParams {
  page?: number;
  page_size?: number;
  company_id?: number;
  guard_id?: number;
  /** El backend expone el filtro como `?status=` (alias de `round_status`). */
  status?: RoundStatus;
  /** Fecha/hora ISO 8601 sobre `created_at`. */
  date_from?: string;
  date_to?: string;
}

/** `GET /rounds`: listado paginado con filtros. */
export async function listRounds(
  params: ListRoundsParams = {},
): Promise<Paginated<Round>> {
  const { data } = await api.get<Paginated<Round>>('/rounds', { params });
  return data;
}

/** `GET /rounds/summary`: totales por estado. */
export async function getRoundsSummary(params: {
  company_id?: number;
  date_from?: string;
  date_to?: string;
} = {}): Promise<RoundSummary> {
  const { data } = await api.get<RoundSummary>('/rounds/summary', { params });
  return data;
}

/** `GET /rounds/{id}`: ronda con sus checkpoints NFC. */
export async function getRound(roundId: number): Promise<RoundDetail> {
  const { data } = await api.get<RoundDetail>(`/rounds/${roundId}`);
  return data;
}

/** `GET /rounds/{id}/logs`: trazabilidad NFC de una ronda. */
export async function listRoundLogs(roundId: number): Promise<RoundLog[]> {
  const { data } = await api.get<RoundLog[]>(`/rounds/${roundId}/logs`);
  return data;
}

/**
 * `GET /rounds/active`: ronda en curso (o pausada) del guardia autenticado.
 *
 * Devuelve `null` cuando no hay ninguna ronda abierta, de modo que la pantalla
 * muestra un estado vacío en lugar de un error.
 */
export async function getActiveRound(): Promise<RoundDetail | null> {
  const { data } = await api.get<RoundDetail | null>('/rounds/active');
  return data;
}

/** `GET /rounds/{id}/checkpoints`: puntos de la ronda con su estado de visita. */
export async function listRoundCheckpoints(
  roundId: number,
): Promise<RoundCheckpoint[]> {
  const { data } = await api.get<RoundCheckpoint[]>(`/rounds/${roundId}/checkpoints`);
  return data;
}

/**
 * `POST /rounds/{id}/checkin`: registra la marcación de un checkpoint.
 *
 * El backend resuelve el QR, valida la geovalla y devuelve el punto y el log
 * creados; cualquier rechazo llega como error con un mensaje en español.
 */
export async function checkIn(
  roundId: number,
  payload: CheckInPayload,
): Promise<CheckInResult> {
  const { data } = await api.post<CheckInResult>(`/rounds/${roundId}/checkin`, payload);
  return data;
}

/** `POST /rounds/{id}/start`: inicia una ronda pendiente del guardia. */
export async function startRound(roundId: number): Promise<RoundDetail> {
  const { data } = await api.post<RoundDetail>(`/rounds/${roundId}/start`);
  return data;
}

/** `POST /rounds/{id}/comments`: añade una nota operativa firmada. */
export async function addRoundComment(
  roundId: number,
  comment: string,
): Promise<RoundDetail> {
  const { data } = await api.post<RoundDetail>(`/rounds/${roundId}/comments`, { comment });
  return data;
}

export const roundsApi = {
  list: listRounds,
  summary: getRoundsSummary,
  get: getRound,
  logs: listRoundLogs,
  addComment: addRoundComment,
  active: getActiveRound,
  checkpoints: listRoundCheckpoints,
  checkIn,
  start: startRound,
};
