/**
 * Tipos de las respuestas del backend FastAPI.
 *
 * Se mantienen alineados con `backend/app/schemas/*.py`. Si un esquema cambia
 * en el backend, hay que actualizar el tipo correspondiente aquí.
 */

export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'COMPANY_USER' | 'GUARD';

export type RoundStatus = 'PENDING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

export type RoundLogStatus = 'OK' | 'INCIDENT' | 'SKIPPED';

/** Estado operativo de un checkpoint dentro de una ronda. */
export type RoundCheckpointStatus = 'PENDING' | 'COMPLETED';

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
  /** Segundos de ronda (sin pausas) transcurridos al marcar el punto. */
  elapsed_seconds: number | null;
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
  paused_at: string | null;
  /** Segundos acumulados en pausas ya cerradas. */
  paused_seconds: number;
  last_activity_at: string | null;
  cancel_reason: string | null;
  observations: string | null;
  created_at: string;
  /** Cronómetro efectivo (sin pausas) calculado por el backend. */
  elapsed_seconds: number;
  /** Límite de inactividad; `null` si la ronda no está en curso. */
  inactivity_deadline: string | null;
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
  status: RoundCheckpointStatus;
  is_visited: boolean;
  visited_at: string | null;
  /** Segundos acumulados de ronda al visitar el punto (sin pausas). */
  elapsed_seconds: number | null;
  /** Segundos transcurridos desde la marcación anterior de la ronda. */
  segment_seconds: number | null;
}

/** Payload de `POST /rounds/{id}/checkin` (`RoundCheckInCreate`). */
export interface CheckInPayload {
  qr_code: string;
  latitude: number;
  longitude: number;
  /**
   * Instante real del escaneo (ISO 8601). El backend lo usa para conservar la
   * hora y el cronómetro cuando una marcación se sincroniza desde la cola.
   */
  timestamp?: string;
}

/** Respuesta de una marcación validada (`RoundCheckInRead`). */
export interface CheckInResult {
  message: string;
  distance_m: number;
  checkpoint: RoundCheckpoint;
  log: RoundLog;
  round_status: RoundStatus;
  /** `true` cuando esta marcación completó todos los puntos de la ronda. */
  round_completed: boolean;
  remaining_checkpoints: number;
  round_elapsed_seconds: number;
}
