/**
 * Utilidades de formato de fechas y duraciones usadas por las pantallas de
 * rondas. Todas las fechas que llegan del backend incluyen offset UTC, por lo
 * que `Date` las interpreta correctamente y se muestran en la hora local.
 */

/** Convierte una duración en segundos a `HH:MM:SS`. */
export function formatClock(totalSeconds: number | null | undefined): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

/** Convierte una duración en segundos a un texto legible ("1 h 05 min"). */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds ?? 0));

  if (safeSeconds < 60) {
    return `${safeSeconds} s`;
  }

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  }

  return `${minutes} min ${String(safeSeconds % 60).padStart(2, '0')} s`;
}

/** Fecha local válida a partir de un ISO del backend, o `null`. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Hora local `HH:MM` (vacío si la fecha no es válida). */
export function formatTime(value: string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return '';
  }

  return [date.getHours(), date.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** Fecha local `dd/mm/aaaa HH:MM` (vacío si la fecha no es válida). */
export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const time = formatTime(value);

  return `${day}/${month}/${year} ${time}`;
}

/** Segundos restantes hasta una fecha futura (nunca negativos). */
export function secondsUntil(value: string | null | undefined): number | null {
  const date = parseDate(value);

  if (!date) {
    return null;
  }

  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
}
