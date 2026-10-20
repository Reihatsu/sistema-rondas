/**
 * Tipos de las respuestas del backend FastAPI.
 *
 * Se mantienen alineados con `backend/app/schemas/*.py`. Si un esquema cambia
 * en el backend, hay que actualizar el tipo correspondiente aquí.
 */

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'COMPANY_USER' | 'GUARD';

export type RoundStatus = 'PENDING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

export type RoundLogStatus = 'OK' | 'INCIDENT' | 'SKIPPED';

export interface CompanySummary {
  id: number;
  name: string;
  tax_id: string;
  is_active: boolean;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

/** Usuario devuelto por `/auth/login` (`UserRead` en el backend). */
export interface AuthUser extends UserSummary {
  created_at: string;
  companies: CompanySummary[];
}

/**
 * Usuario con sus relaciones de supervisión (`UserDetail` en el backend),
 * devuelto por `GET /auth/me`.
 */
export interface UserDetail extends AuthUser {
  supervisors: UserSummary[];
  supervised_guards: UserSummary[];
}

/** Respuesta de `POST /auth/login` (`TokenResponse` en el backend). */
export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

/** Contenedor de resultados paginados (`Paginated[T]` en el backend). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Punto de control (`CheckpointRead` en el backend). */
export interface Checkpoint {
  id: number;
  company_id: number;
  name: string;
  code: string;
  location_description: string | null;
  is_active: boolean;
  created_at: string;
  company: CompanySummary | null;
}

/** Registro NFC/QR de una ronda (`RoundLogRead` en el backend). */
export interface RoundLog {
  id: number;
  round_id: number;
  checkpoint_id: number | null;
  nfc_tag_id: string;
  checkpoint_name: string;
  latitude: number | null;
  longitude: number | null;
  distance_m: number | null;
  timestamp: string;
  status: RoundLogStatus;
}

/** Ronda (`RoundRead` en el backend). */
export interface Round {
  id: number;
  company_id: number;
  guard_id: number;
  status: RoundStatus;
  start_time: string | null;
  end_time: string | null;
  observations: string | null;
  created_at: string;
  company: CompanySummary | null;
  guard: UserSummary | null;
}

/** Ronda con su trazabilidad (`RoundDetail` en el backend). */
export interface RoundDetail extends Round {
  logs: RoundLog[];
}

export interface RoundStatusCount {
  status: RoundStatus;
  count: number;
}

/** Resumen de rondas por estado (`RoundSummary` en el backend). */
export interface RoundSummary {
  total: number;
  by_status: RoundStatusCount[];
}

/**
 * Punto de control dentro de una ronda con su estado de visita
 * (`RoundCheckpointRead` en el backend).
 */
export interface RoundCheckpoint {
  id: number;
  name: string;
  code: string;
  location_description: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Radio de la geovalla en metros. */
  geofence_radius_m: number;
  is_visited: boolean;
  visited_at: string | null;
}

/** Payload de `POST /rounds/{id}/checkin` (`RoundCheckInCreate`). */
export interface CheckInPayload {
  qr_code: string;
  latitude: number;
  longitude: number;
}

/** Respuesta de una marcación validada (`RoundCheckInRead`). */
export interface CheckInResult {
  message: string;
  distance_m: number;
  checkpoint: RoundCheckpoint;
  log: RoundLog;
}
