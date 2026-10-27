/**
 * Lectura de etiquetas NFC de puntos de control.
 *
 * Expone dos modos:
 * - `readNfcTag()`: sesión de una sola lectura para el escaneo manual.
 * - `startNfcTagListener()`: modo lector pasivo que mantiene la sesión abierta
 *   y entrega cada etiqueta detectada, usado por la pantalla de ronda activa.
 *
 * La versión web (`nfc.web.ts`) expone la misma API pero siempre informa que el
 * dispositivo no tiene NFC.
 */

import NfcManager, { NfcAdapter, NfcEvents } from 'react-native-nfc-manager';
import type { TagEvent } from 'react-native-nfc-manager';

import { canonicalNfcUid } from '@/services/nfcUid';

/** Motivos por los que una lectura NFC no puede completarse. */
export type NfcFailureReason =
  | 'unsupported'
  | 'disabled'
  | 'timeout'
  | 'read'
  | 'cancelled';

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

interface ReadNfcTagOptions {
  /** Tiempo máximo de espera antes de cancelar la sesión NFC. */
  timeoutMs?: number;
  /** Mensaje del diálogo nativo de iOS mientras se busca la etiqueta. */
  alertMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_ALERT_MESSAGE =
  'Acerca el móvil a la etiqueta NFC del punto de control';

let managerStarted = false;
let pendingRead: ((error: NfcError) => void) | null = null;

async function startManager(): Promise<void> {
  if (managerStarted) {
    return;
  }

  await NfcManager.start();
  managerStarted = true;
}

/** Indica si el dispositivo puede leer NFC (y el módulo quedó operativo). */
export async function isNfcSupported(): Promise<boolean> {
  try {
    await startManager();
    return await NfcManager.isSupported();
  } catch (error) {
    console.warn('[nfc] No se pudo consultar el soporte NFC:', error);
    return false;
  }
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
 */
export async function startNfcTagListener(
  onTag: (tag: NfcTagRead) => void,
  options: NfcTagListenerOptions = {},
): Promise<NfcTagListener> {
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

    onTag({ uid, techTypes: tag?.techTypes ?? [] });
  };

  NfcManager.setEventListener(NfcEvents.DiscoverTag, handleDiscoverTag);

  try {
    await NfcManager.registerTagEvent({
      alertMessage: options.alertMessage ?? DEFAULT_ALERT_MESSAGE,
      // Mantiene la sesión abierta después de cada lectura para el modo pasivo.
      invalidateAfterFirstRead: false,
      isReaderModeEnabled: true,
      readerModeFlags:
        NfcAdapter.FLAG_READER_NFC_A |
        NfcAdapter.FLAG_READER_NFC_B |
        NfcAdapter.FLAG_READER_NFC_F |
        NfcAdapter.FLAG_READER_NFC_V |
        NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
      // Pequeña espera para no bombardear con la misma etiqueta si permanece
      // apoyada sobre el lector.
      readerModeDelay: 500,
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

  return {
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);

      try {
        await NfcManager.unregisterTagEvent();
      } catch (error) {
        console.warn('[nfc] No se pudo cerrar el lector NFC:', error);
      }
    },
  };
}

/**
 * Espera a que el guardia acerque una etiqueta y devuelve su UID canónico.
 *
 * La sesión se cierra siempre (éxito, error, tiempo agotado o cancelación) para
 * que la pantalla de la ronda pueda volver a escanear sin reiniciar la app.
 */
export async function readNfcTag(
  options: ReadNfcTagOptions = {},
): Promise<NfcTagRead> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const alertMessage = options.alertMessage ?? DEFAULT_ALERT_MESSAGE;

  await ensureNfcEnabled();

  return new Promise<NfcTagRead>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = async () => {
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
      pendingRead = null;

      try {
        await NfcManager.unregisterTagEvent();
      } catch (error) {
        console.warn('[nfc] No se pudo cerrar la sesión NFC:', error);
      }
    };

    const finish = (error: NfcError | null, tag?: NfcTagRead) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      void cleanup().then(() => {
        if (error) {
          reject(error);
        } else {
          resolve(tag as NfcTagRead);
        }
      });
    };

    pendingRead = (error: NfcError) => finish(error);

    NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag) => {
      const uid = canonicalNfcUid(tag?.id);

      if (!uid) {
        finish(
          new NfcError(
            'read',
            'La etiqueta no expone un UID legible. Verifique que sea una etiqueta NFC programada.',
          ),
        );
        return;
      }

      finish(null, { uid, techTypes: tag?.techTypes ?? [] });
    });

    timer = setTimeout(() => {
      finish(
        new NfcError(
          'timeout',
          'No se detectó ninguna etiqueta NFC. Acérquela al lector y vuelva a intentarlo.',
        ),
      );
    }, timeoutMs);

    void NfcManager.registerTagEvent({
      alertMessage,
      invalidateAfterFirstRead: true,
      isReaderModeEnabled: true,
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? ` (${error.message})` : '';
      finish(
        new NfcError(
          'read',
          `No se pudo iniciar la lectura NFC${detail}. Intente de nuevo.`,
        ),
      );
    });
  });
}

/** Cancela una lectura en curso, por ejemplo al salir de la pantalla. */
export function cancelNfcScan(): void {
  pendingRead?.(
    new NfcError('cancelled', 'Lectura NFC cancelada. Puede intentarlo de nuevo.'),
  );
}
