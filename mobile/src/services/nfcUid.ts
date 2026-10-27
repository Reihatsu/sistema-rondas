/**
 * Utilidades de los UID de etiquetas NFC.
 *
 * El backend guarda el UID en hexadecimal mayúsculas y sin separadores
 * (`app.schemas.checkpoint.normalize_uid`). Android entrega `04A23B4C5D6E`,
 * iOS o una etiqueta impresa pueden mostrar `04:A2:3B:4C:5D:6E`, así que la app
 * aplica la misma canonicalización antes de comparar o enviar el UID.
 */

/** Caracteres válidos de un UID una vez normalizado (mismo criterio que el backend). */
const NON_ALPHANUMERIC = /[^0-9A-Z]/g;

/**
 * Devuelve el UID canónico (`04A23B4C5D6E`) o cadena vacía si no hay UID.
 */
export function canonicalNfcUid(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toUpperCase().replace(NON_ALPHANUMERIC, '');
}

/** Indica si dos UID representan la misma etiqueta, sin importar el formato. */
export function isSameNfcUid(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const a = canonicalNfcUid(first);
  return a !== '' && a === canonicalNfcUid(second);
}

/** Presenta el UID agrupado en pares (`04 A2 3B 4C 5D 6E`) para la interfaz. */
export function formatNfcUid(value: string | null | undefined): string {
  const canonical = canonicalNfcUid(value);

  if (!canonical) {
    return '';
  }

  return canonical.replace(/(.{2})(?=.)/g, '$1 ');
}
