/**
 * Versión web del servicio NFC.
 *
 * Los navegadores no tienen acceso a `react-native-nfc-manager`, así que se
 * mantiene la misma API que `nfc.ts` pero informando que no hay lector. Metro
 * resuelve este archivo automáticamente en la plataforma `web`.
 */

export type NfcFailureReason = 'unsupported' | 'disabled' | 'read';

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
  /** Texto NDEF leído de la etiqueta; `null` si no contiene uno. */
  text: string | null;
  techTypes: string[];
}

export interface NfcTagListenerOptions {
  alertMessage?: string;
}

export interface NfcTagListener {
  stop: () => Promise<void>;
}

const WEB_UNSUPPORTED_MESSAGE =
  'La lectura NFC solo está disponible en la app móvil. En el navegador use el código QR.';

export async function startNfcTagListener(
  _onTag: (tag: NfcTagRead) => void,
  _options: NfcTagListenerOptions = {},
): Promise<NfcTagListener> {
  throw new NfcError('unsupported', WEB_UNSUPPORTED_MESSAGE);
}

