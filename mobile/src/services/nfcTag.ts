/**
 * Traducción de una lectura NFC al punto de control de la ronda.
 *
 * La etiqueta lleva grabado el **código del punto** (`NFC-EMP2-PT03`) como
 * texto NDEF y ese texto es el identificador principal. El UID se conserva como
 * validación secundaria: si el punto tiene un UID registrado, ambos deben
 * coincidir para que la marcación sea válida. Así una etiqueta regrabada o un
 * UID cambiado no marcan el punto equivocado.
 *
 * La comparación del texto no usa `normalize_uid`: ese helper elimina los
 * separadores y los códigos sí llevan guiones.
 */

import type { RoundCheckpoint } from '@/api/types';
import { canonicalNfcUid, formatNfcUid } from '@/services/nfcUid';

/** Caracteres de control e invisibles que algunos grabadores añaden al NDEF. */
const INVISIBLE_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g;

const WHITESPACE = /\s+/g;

/**
 * Canoniza el texto NDEF para compararlo con `checkpoint.code`.
 *
 * Elimina caracteres invisibles, colapsa los espacios accidentales y pasa a
 * mayúsculas, pero **conserva los guiones** del código.
 */
export function canonicalNfcText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(INVISIBLE_CHARACTERS, ' ')
    .replace(WHITESPACE, ' ')
    .trim()
    .toUpperCase();
}

/** Datos mínimos de una lectura NFC necesarios para resolver el punto. */
export interface NfcTagPayload {
  uid: string;
  text: string | null;
}

/** Resultado de buscar el punto de una etiqueta NFC dentro de la ronda. */
export type NfcTagMatchResult =
  | {
      ok: true;
      checkpoint: RoundCheckpoint;
      /** `code+uid` si el punto tiene UID registrado y también coincide. */
      matchedBy: 'code' | 'code+uid';
      /** Texto NDEF canonizado. */
      text: string;
      /** UID canónico leído. */
      uid: string;
    }
  | {
      ok: false;
      /** La etiqueta no contiene ningún registro NDEF de texto. */
      reason: 'no-ndef';
      text: string;
      uid: string;
    }
  | {
      ok: false;
      /** El texto no es el código de ningún punto de esta ronda. */
      reason: 'code-not-found';
      text: string;
      uid: string;
    }
  | {
      ok: false;
      /** El texto coincide con el punto, pero el UID no es el registrado. */
      reason: 'uid-mismatch';
      text: string;
      uid: string;
      checkpoint: RoundCheckpoint;
      /** UID que tiene registrado el punto. */
      expectedUid: string;
    };

/**
 * Busca el punto de la ronda cuya etiqueta NFC corresponde a la lectura.
 *
 * Reglas:
 * 1. El texto NDEF es obligatorio: sin texto no se puede identificar el punto.
 * 2. El texto debe coincidir con el `code` de un punto de la ronda (sin
 *    distinguir mayúsculas ni espacios accidentales).
 * 3. Si el punto tiene `uid_nfc`, el UID leído también debe coincidir. Si el
 *    punto aún no tiene UID registrado, se acepta solo el texto.
 */
export function findCheckpointByNfcTag(
  tag: NfcTagPayload,
  checkpoints: readonly RoundCheckpoint[],
): NfcTagMatchResult {
  const uid = canonicalNfcUid(tag.uid);
  const text = canonicalNfcText(tag.text);

  if (!text) {
    return { ok: false, reason: 'no-ndef', text, uid };
  }

  const checkpoint = checkpoints.find(
    (item) => canonicalNfcText(item.code) === text,
  );

  if (!checkpoint) {
    return { ok: false, reason: 'code-not-found', text, uid };
  }

  const expectedUid = canonicalNfcUid(checkpoint.uid_nfc);

  if (expectedUid && expectedUid !== uid) {
    return {
      ok: false,
      reason: 'uid-mismatch',
      text,
      uid,
      checkpoint,
      expectedUid,
    };
  }

  return {
    ok: true,
    checkpoint,
    matchedBy: expectedUid ? 'code+uid' : 'code',
    text,
    uid,
  };
}

/**
 * Mensaje para la UI que indica explícitamente cuál validación falló: el texto
 * NDEF de la etiqueta o el UID frente al registrado en el punto.
 */
export function describeNfcTagFailure(
  result: Extract<NfcTagMatchResult, { ok: false }>,
): string {
  switch (result.reason) {
    case 'no-ndef':
      return (
        `La etiqueta ${formatNfcUid(result.uid)} no contiene texto NDEF. ` +
        'Grabe el código del punto (el mismo que aparece en la lista de ' +
        'puntos, por ejemplo NFC-EMP2-PT03) como texto en la etiqueta.'
      );
    case 'code-not-found':
      return (
        `El texto «${result.text}» de la etiqueta (UID ` +
        `${formatNfcUid(result.uid)}) no corresponde al código de ningún ` +
        'punto de esta ronda. Verifique que acercó la etiqueta correcta.'
      );
    case 'uid-mismatch':
      return (
        `El texto «${result.text}» sí corresponde a «${result.checkpoint.name}», ` +
        `pero el UID ${formatNfcUid(result.uid)} no coincide con el registrado ` +
        `para ese punto (${formatNfcUid(result.expectedUid)}). Actualice el UID ` +
        'del punto o use la etiqueta correcta.'
      );
  }
}
