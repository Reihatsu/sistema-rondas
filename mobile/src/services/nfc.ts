/**
 * Lectura pasiva de etiquetas NFC de puntos de control.
 *
 * `startNfcTagListener()` mantiene una única sesión abierta y entrega cada
 * etiqueta detectada; la usa la pantalla de ronda activa para que el guardia
 * solo acerque el móvil, sin pulsar ningún botón.
 *
 * Android exige `readerModeFlags` distintos de cero cuando
 * `isReaderModeEnabled` es `true`; pasar `0` lanza una excepción nativa que el
 * módulo no siempre convierte en error de JavaScript y puede cerrar la app.
 * Aquí las flags se definen una sola vez y se usan en todas las lecturas.
 *
 * La versión web (`nfc.web.ts`) expone la misma API pero siempre informa que el
 * dispositivo no tiene NFC.
 */

import NfcManager, { NfcAdapter, NfcEvents } from 'react-native-nfc-manager';
import type { TagEvent } from 'react-native-nfc-manager';

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
const READER_MODE_DELAY_MS = 500;

/**
 * Tecnologías que el lector acepta. `SKIP_NDEF_CHECK` evita que Android intente
 * parsear el NDEF antes de entregar el UID, que es lo único que necesita la app.
 */
const NFC_READER_MODE_FLAGS =
  NfcAdapter.FLAG_READER_NFC_A |
  NfcAdapter.FLAG_READER_NFC_B |
  NfcAdapter.FLAG_READER_NFC_F |
  NfcAdapter.FLAG_READER_NFC_V |
  NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;

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
 * Inicia una sesión NFC pasiva que entrega cada etiqueta detectada.
 *
 * Se usa en la pantalla de ronda activa para que el guardia solo acerque el
 * móvil a la etiqueta, sin pulsar ningún botón. En Android se activa el modo
 * lector nativo con las tecnologías más comunes; en iOS se muestra el diálogo
 * de `NFCTagReaderSession`. La sesión permanece abierta hasta llamar a
 * `stop()`, que debe ejecutarse al pausar/finalizar la ronda o desmontar la
 * pantalla.
 *
 * Solo puede existir una sesión activa: antes de registrar la nueva se cierra
 * la anterior y todas las operaciones se serializan en `sessionQueue`.
 */
export async function startNfcTagListener(
  onTag: (tag: NfcTagRead) => void,
  options: NfcTagListenerOptions = {},
): Promise<NfcTagListener> {
  return enqueueSession(async () => {
    // Salvaguarda: nunca se llama a `registerTagEvent` en modo lector con 0
    // flags, aunque una versión futura del paquete deje de exportar constantes.
    if (!NFC_READER_MODE_FLAGS) {
      throw new NfcError(
        'read',
        'El lector NFC no está disponible en este dispositivo. Use el escaneo de código QR.',
      );
    }

    await ensureNfcEnabled();
    await closeActiveSession();

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

      onTag({ uid, techTypes: tag?.techTypes ?? [] });
    };

    NfcManager.setEventListener(NfcEvents.DiscoverTag, handleDiscoverTag);

    try {
      await NfcManager.registerTagEvent({
        alertMessage: options.alertMessage ?? DEFAULT_ALERT_MESSAGE,
        // Mantiene la sesión abierta después de cada lectura para el modo pasivo.
        invalidateAfterFirstRead: false,
        isReaderModeEnabled: true,
        // Nunca debe llegar 0: Android lanza una excepción nativa en ese caso.
        readerModeFlags: NFC_READER_MODE_FLAGS,
        // Pequeña espera para no bombardear con la misma etiqueta si permanece
        // apoyada sobre el lector.
        readerModeDelay: READER_MODE_DELAY_MS,
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
