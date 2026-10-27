/**
 * Lectura pasiva de etiquetas NFC de puntos de control.
 *
 * `startNfcTagListener()` mantiene una única sesión abierta y entrega cada
 * etiqueta detectada; la usa la pantalla de ronda activa para que el guardia
 * solo acerque el móvil, sin pulsar ningún botón.
 *
 * En Android se usa el despacho en primer plano (`enableForegroundDispatch`),
 * que es el modo por defecto de `registerTagEvent`. No se activa el modo lector
 * nativo (`enableReaderMode`): en Android 16 y en algunos servicios NFC de
 * fabricantes ese cambio de estado lanza una excepción nativa que no se puede
 * capturar desde JavaScript y Android cierra la aplicación. El despacho en
 * primer plano es igualmente pasivo mientras la pantalla de la ronda está
 * enfocada y es el camino estable de la librería.
 *
 * La versión web (`nfc.web.ts`) expone la misma API pero siempre informa que el
 * dispositivo no tiene NFC.
 */

import NfcManager, { Ndef, NfcEvents } from 'react-native-nfc-manager';
import type { NdefRecord, TagEvent } from 'react-native-nfc-manager';

import { canonicalNfcUid } from '@/services/nfcUid';

/** Motivos por los que una lectura NFC no puede completarse. */
export type NfcFailureReason = 'unsupported' | 'disabled' | 'read';

/** Error de lectura NFC con un motivo estable para decidir el mensaje en la UI. */
export class NfcError extends Error {
  readonly reason: NfcFailureReason;

  constructor(reason: NfcFailureReason, message: string) {
    super(message);
    this.name = 'NfcError';
    this.reason = reason;
  }
}

export interface NfcTagRead {
  /** UID canónico: hexadecimal en mayúsculas y sin separadores. */
  uid: string;
  /**
   * Texto del primer registro NDEF de tipo texto, o `null` si la etiqueta no
   * tiene NDEF o solo contiene registros que no son de texto.
   *
   * El código del punto de control (`NFC-EMP2-PT03`) se graba en la etiqueta
   * como texto NDEF; el UID queda como validación secundaria.
   */
  text: string | null;
  /** Tecnologías detectadas por el sistema (solo informativo). */
  techTypes: string[];
}

export interface NfcTagListenerOptions {
  /** Mensaje del diálogo nativo de iOS mientras el lector está activo. */
  alertMessage?: string;
}

/**
 * Sesión NFC pasiva activa.
 *
 * `stop()` es idempotente: puede llamarse al desmontar la pantalla, al pausar
 * la ronda o después de un error sin lanzar excepciones.
 */
export interface NfcTagListener {
  stop: () => Promise<void>;
}

const DEFAULT_ALERT_MESSAGE =
  'Acerca el móvil a la etiqueta NFC del punto de control';

let managerStarted = false;
let managerStartPromise: Promise<void> | null = null;
let activeSessionStop: (() => Promise<void>) | null = null;
/**
 * Cola que serializa abrir y cerrar sesiones. El plugin nativo maneja una sola
 * sesión global: registrar dos lectores a la vez (por ejemplo, al volver de
 * segundo plano o al entrar a la ronda) corrompe el estado y puede cerrar la
 * app.
 */
let sessionQueue: Promise<void> = Promise.resolve();

function enqueueSession<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionQueue.then(operation, operation);
  sessionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function createSessionStop(): () => Promise<void> {
  let stopped = false;

  const stop = async () => {
    if (stopped) {
      return;
    }

    stopped = true;

    if (activeSessionStop === stop) {
      activeSessionStop = null;
    }

    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);

    try {
      await NfcManager.unregisterTagEvent();
    } catch (error) {
      console.warn('[nfc] No se pudo cerrar el lector NFC:', error);
    }
  };

  return stop;
}

async function closeActiveSession(): Promise<void> {
  const stop = activeSessionStop;
  activeSessionStop = null;

  if (stop) {
    await stop();
  }
}

async function startManager(): Promise<void> {
  if (managerStarted) {
    return;
  }

  managerStartPromise ??= NfcManager.start()
    .then(() => {
      managerStarted = true;
    })
    .finally(() => {
      managerStartPromise = null;
    });

  await managerStartPromise;
}

async function ensureNfcEnabled(): Promise<void> {
  await startManager();

  if (!(await NfcManager.isSupported())) {
    throw new NfcError(
      'unsupported',
      'Este dispositivo no tiene lector NFC. Use el escaneo de código QR.',
    );
  }

  if (!(await NfcManager.isEnabled())) {
    throw new NfcError(
      'disabled',
      'El NFC está desactivado. Actívelo en los ajustes del dispositivo.',
    );
  }
}

/**
 * Extrae el texto del primer registro NDEF de tipo texto.
 *
 * Android entrega el payload como arreglo de bytes e iOS también lo expone
 * como bytes, por eso se decodifica con `Ndef.text.decodePayload`, que descarta
 * el código de idioma del registro. Un registro ilegible no debe romper la
 * lectura: se ignora y se prueba con el siguiente.
 */
function readNdefText(records: NdefRecord[] | undefined): string | null {
  if (!records?.length) {
    return null;
  }

  for (const record of records) {
    if (!Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_TEXT)) {
      continue;
    }

    try {
      const text = Ndef.text.decodePayload(Uint8Array.from(record.payload));

      if (typeof text === 'string' && text.trim()) {
        return text;
      }
    } catch (error) {
      console.warn('[nfc] Registro NDEF de texto ilegible:', error);
    }
  }

  return null;
}

/**
 * Inicia una sesión NFC pasiva que entrega cada etiqueta detectada.
 *
 * Se usa en la pantalla de ronda activa para que el guardia solo acerque el
 * móvil a la etiqueta, sin pulsar ningún botón. En Android se registra el
 * despacho en primer plano; en iOS se muestra el diálogo de
 * `NFCTagReaderSession`. La sesión permanece abierta hasta llamar a `stop()`,
 * que debe ejecutarse al pausar/finalizar la ronda o desmontar la pantalla.
 *
 * Solo puede existir una sesión activa: antes de registrar la nueva se cierra
 * la anterior y todas las operaciones se serializan en `sessionQueue`.
 */
export async function startNfcTagListener(
  onTag: (tag: NfcTagRead) => void,
  options: NfcTagListenerOptions = {},
): Promise<NfcTagListener> {
  return enqueueSession(async () => {
    // Cierra cualquier sesión anterior aunque el NFC se haya desactivado: así
    // no queda un lector colgado esperando una etiqueta.
    await closeActiveSession();
    await ensureNfcEnabled();

    let stopped = false;

    const handleDiscoverTag = (tag: TagEvent) => {
      if (stopped) {
        return;
      }

      const uid = canonicalNfcUid(tag?.id);

      if (!uid) {
        // Una etiqueta ilegible no debe cerrar la sesión: se ignora para que el
        // guardia pueda acercar otra sin reiniciar el lector.
        console.warn('[nfc] Etiqueta sin UID legible:', tag);
        return;
      }

      onTag({
        uid,
        text: readNdefText(tag?.ndefMessage),
        techTypes: tag?.techTypes ?? [],
      });
    };

    NfcManager.setEventListener(NfcEvents.DiscoverTag, handleDiscoverTag);

    try {
      // Sin `isReaderModeEnabled`: Android usa el despacho en primer plano.
      // Es pasivo, entrega el UID y evita el cierre nativo de `enableReaderMode`
      // que ocurre en algunos dispositivos con Android 16.
      await NfcManager.registerTagEvent({
        alertMessage: options.alertMessage ?? DEFAULT_ALERT_MESSAGE,
        // Mantiene la sesión abierta después de cada lectura para el modo pasivo.
        invalidateAfterFirstRead: false,
      });
    } catch (error) {
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);

      try {
        await NfcManager.unregisterTagEvent();
      } catch {
        // La sesión no llegó a abrirse; no hay nada más que limpiar.
      }

      const detail = error instanceof Error ? ` (${error.message})` : '';
      throw new NfcError(
        'read',
        `No se pudo iniciar el lector NFC${detail}. Intente de nuevo.`,
      );
    }

    const stop = createSessionStop();
    activeSessionStop = stop;

    // El `stopped` local evita entregar etiquetas después de cerrar la sesión;
    // el `stop` global es idempotente y serializado.
    const close = async () => {
      stopped = true;
      await enqueueSession(stop);
    };

    return { stop: close };
  });
}
