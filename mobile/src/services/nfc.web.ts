/**
 * Versión web del servicio NFC.
 *
 * Los navegadores no tienen acceso a `react-native-nfc-manager`, así que se
 * mantiene la misma API que `nfc.ts` pero informando que no hay lector. Metro
 * resuelve este archivo automáticamente en la plataforma `web`.
 */

export type NfcFailureReason =
  | 'unsupported'
  | 'disabled'
  | 'timeout'
  | 'read'
  | 'cancelled';

export class NfcError extends Error {
  readonly reason: NfcFailureReason;

  constructor(reason: NfcFailureReason, message: string) {
    super(message);
    this.name = 'NfcError';
    this.reason = reason;
  }
}

export interface NfcTagRead {
  uid: string;
  techTypes: string[];
}

interface ReadNfcTagOptions {
  timeoutMs?: number;
  alertMessage?: string;
}

const WEB_UNSUPPORTED_MESSAGE =
  'La lectura NFC solo está disponible en la app móvil. En el navegador use el código QR.';

/** En web nunca hay lector NFC. */
export async function isNfcSupported(): Promise<boolean> {
  return false;
}

export async function readNfcTag(
  _options: ReadNfcTagOptions = {},
): Promise<NfcTagRead> {
  throw new NfcError('unsupported', WEB_UNSUPPORTED_MESSAGE);
}

export function cancelNfcScan(): void {
  // No hay sesión NFC en web: nada que cancelar.
}

