/** Etiquetas y utilidades de formato compartidas por la interfaz. */

export const ROLE_LABELS = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  COMPANY_USER: "Usuario de empresa",
  GUARD: "Guardia",
};

export const HOME_BY_ROLE = {
  ADMIN: "/empresas",
  SUPERVISOR: "/guardias",
  COMPANY_USER: "/rondas",
  GUARD: "/rondas",
};

export function homeForRole(role) {
  return HOME_BY_ROLE[role] || "/login";
}

export const STATUS_LABELS = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En curso",
  PAUSED: "Pausada",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export const LOG_STATUS_LABELS = {
  OK: "Correcto",
  INCIDENT: "Incidencia",
  SKIPPED: "Omitido",
};

/** Tecnología con la que se identifican los puntos de control de una empresa. */
export const POINT_TYPE_LABELS = {
  QR: "Código QR",
  NFC: "Etiqueta NFC",
};

export const POINT_TYPE_SHORT_LABELS = {
  QR: "QR",
  NFC: "NFC",
};

export const POINT_TYPE_TONES = {
  QR: "info",
  NFC: "purple",
};

export const STATUS_TONES = {
  PENDING: "neutral",
  IN_PROGRESS: "info",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export const LOG_STATUS_TONES = {
  OK: "success",
  INCIDENT: "danger",
  SKIPPED: "warning",
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

/** Duración legible entre dos instantes ISO (o desde el inicio si no ha acabado). */
export function formatDuration(start, end) {
  if (!start) return "—";
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return "—";
  const minutes = Math.round((to - from) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return `${hours} h ${String(rest).padStart(2, "0")} min`;
}

/** Convierte un Date a valor aceptado por <input type="datetime-local">. */
export function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
