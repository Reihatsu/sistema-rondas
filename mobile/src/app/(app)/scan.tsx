/**
 * Ruta autenticada `/scan`: escáner QR de checkpoints.
 *
 * Recibe `roundId` como parámetro de navegación.
 */

import QRScannerScreen from '@/screens/QRScannerScreen';

export default function ScanRoute() {
  return <QRScannerScreen />;
}
