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

/**
 * `POST /rounds/start-new`: crea e inicia una ronda nueva del guardia.
 *
 * El backend elige la empresa activa asignada con checkpoints operativos y
 * devuelve la ronda ya en `IN_PROGRESS`. Si el guardia ya tiene una ronda
 * abierta responde `409` con el identificador de esa ronda.
 *
 * `companyId` es opcional y viaja como query param: el selector de empresa de
 * la app móvil lo envía para forzar la empresa cuando el guardia tiene varias.
 */
export async function startNewRound(companyId?: number): Promise<RoundDetail> {
  const { data } = await api.post<RoundDetail>('/rounds/start-new', null, {
    params:
      typeof companyId === 'number' && Number.isInteger(companyId) && companyId > 0
        ? { company_id: companyId }
        : undefined,
  });
  return data;
}

export interface ListRoundHistoryParams {
  page?: number;
  page_size?: number;
  /** Limita el historial a una empresa asignada al usuario. */
  company_id?: number;
  /** Si se omite, el backend devuelve pausadas, completadas y canceladas. */
  status?: RoundStatus;
  /** Fecha/hora ISO 8601 sobre `created_at`. */
  date_from?: string;
  date_to?: string;
  /** Ventana en horas cuando no se envía `date_from` (24 por defecto). */
  last_hours?: number;
  /** Ignora la ventana temporal y devuelve todo el historial. */
  all_time?: boolean;
}

/** `GET /rounds/history`: rondas pasadas con sus marcaciones. */
export async function listRoundHistory(
  params: ListRoundHistoryParams = {},
): Promise<Paginated<RoundDetail>> {
  const { data } = await api.get<Paginated<RoundDetail>>('/rounds/history', {
    params,
  });
  return data;
}

/**
 * `POST /rounds/{id}/pause`: pausa la ronda y congela el cronómetro.
 * El comentario es obligatorio en el backend (`RoundPauseCreate`).
 */
export async function pauseRound(
  roundId: number,
  comment: string,
): Promise<RoundDetail> {
  const { data } = await api.post<RoundDetail>(`/rounds/${roundId}/pause`, {
    comment,
  });
  return data;
}

/** `POST /rounds/{id}/resume`: reanuda una ronda pausada. */
export async function resumeRound(roundId: number): Promise<RoundDetail> {
  const { data } = await api.post<RoundDetail>(`/rounds/${roundId}/resume`);
  return data;
}

/** `POST /rounds/{id}/cancel`: cancela la ronda con un motivo obligatorio. */
export async function cancelRound(
  roundId: number,
  reason: string,
): Promise<RoundDetail> {
  const { data } = await api.post<RoundDetail>(`/rounds/${roundId}/cancel`, {
    reason,
  });
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
  history: listRoundHistory,
  checkpoints: listRoundCheckpoints,
  checkIn,
  start: startRound,
  startNew: startNewRound,
  pause: pauseRound,
  resume: resumeRound,
  cancel: cancelRound,
};
