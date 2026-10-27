/**
 * Lectura de etiquetas NFC de puntos de control.
 *
 * Envuelve `react-native-nfc-manager` en una única llamada asíncrona:
 * `readNfcTag()` inicia la sesión, espera la primera etiqueta, devuelve su UID
 * canónico y cierra la sesión. La versión web (`nfc.web.ts`) expone la misma
 * API pero siempre informa que el dispositivo no tiene NFC.
 */

import NfcManager, { NfcEvents } from 'react-native-nfc-manager';

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
