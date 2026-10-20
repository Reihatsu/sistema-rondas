/**
 * Escaneo del código QR de un checkpoint con validación GPS.
 *
 * Flujo: permiso de cámara → lectura del QR → ubicación actual → marcación en
 * la API. El backend es la autoridad final: valida el código, la geovalla y
 * los duplicados, y devuelve mensajes en español que se muestran al guardia.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import { checkIn } from '@/api/rounds';
import type { CheckInResult } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCurrentCoordinates, LocationError } from '@/services/location';
import { formatClock } from '@/utils/datetime';

const ACCENT = '#208AEF';
const SUCCESS = '#1E7F4F';
const DANGER = '#D93025';

type Phase = 'scanning' | 'locating' | 'sending' | 'success' | 'error';

function ResultOverlay({
  variant,
  title,
  message,
  children,
}: {
  variant: 'success' | 'error';
  title: string;
  message: string;
  children: ReactNode;
}) {
  const isSuccess = variant === 'success';

  return (
    <View style={styles.resultOverlay}>
      <View style={styles.resultCard}>
        <View
          style={[
            styles.resultIcon,
            { backgroundColor: isSuccess ? SUCCESS : DANGER },
          ]}>
          <ThemedText type="smallBold" style={styles.onAccent}>
            {isSuccess ? '✓' : '!'}
          </ThemedText>
        </View>

        <ThemedText type="smallBold" style={styles.resultTitle}>
          {title}
        </ThemedText>
        <ThemedText type="small" style={styles.resultMessage}>
          {message}
        </ThemedText>

        <View style={styles.resultActions}>{children}</View>
      </View>
    </View>
  );
}

export default function QRScannerScreen() {
  const router = useRouter();
  const { roundId: rawRoundId } = useLocalSearchParams<{
    roundId?: string | string[];
  }>();
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [canOpenSettings, setCanOpenSettings] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const busyRef = useRef(false);

  const roundIdText = Array.isArray(rawRoundId) ? rawRoundId[0] : rawRoundId;
  const roundId = Number(roundIdText);
  const hasValidRound = Number.isInteger(roundId) && roundId > 0;

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/rondas');
  }, [router]);

  /** Abre los ajustes del sistema; en web no existen ajustes de app. */
  const openSettings = useCallback(() => {
    if (Platform.OS === 'web') {
      return;
    }

    void Linking.openSettings();
  }, []);

  const resetScanner = useCallback(() => {
    setResult(null);
    setErrorMessage(null);
    setIsExpired(false);
    setCanOpenSettings(false);
    setPhase('scanning');
  }, []);

  const handleBarcodeScanned = useCallback(
    async (scan: BarcodeScanningResult) => {
      if (busyRef.current || !hasValidRound) {
        return;
      }

      const code = scan.data?.trim();

      if (!code) {
        return;
      }

      busyRef.current = true;
      setErrorMessage(null);
      setCanOpenSettings(false);
      setPhase('locating');

      try {
        const coordinates = await getCurrentCoordinates();
        setPhase('sending');

        const response = await checkIn(roundId, {
          qr_code: code,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        });

        setResult(response);
        setPhase('success');
      } catch (scanError) {
        if (scanError instanceof LocationError) {
          setCanOpenSettings(
            scanError.code === 'permission' || scanError.code === 'services',
          );
        }

        const message = getErrorMessage(scanError);
        const expired = /inactividad/i.test(message);

        setIsExpired(expired);
        setErrorMessage(message);
        setPhase('error');

        if (expired) {
          Alert.alert('Ronda cancelada por inactividad', message);
        }
      } finally {
        busyRef.current = false;
      }
    },
    [hasValidRound, roundId],
  );

  if (!hasValidRound) {
    return (
      <ThemedView style={styles.fallbackContainer}>
        <SafeAreaView style={styles.fallbackSafeArea} edges={['top', 'bottom']}>
          <ThemedText type="smallBold">No se indicó la ronda</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Vuelva a la lista de checkpoints e intente escanear de nuevo.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a la ronda"
            onPress={goBack}
            style={({ pressed }) => [
              styles.primaryButton,
              { opacity: pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="smallBold" style={styles.onAccent}>
              Volver a la ronda
            </ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!permission) {
    return (
      <View style={styles.permissionLoading}>
        <ActivityIndicator color="#FFFFFF" size="large" />
        <ThemedText type="small" style={styles.onAccent}>
          Preparando la cámara…
        </ThemedText>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.fallbackContainer}>
        <SafeAreaView style={styles.fallbackSafeArea} edges={['top', 'bottom']}>
          <ThemedText type="smallBold">Necesitamos acceso a la cámara</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            La cámara se usa únicamente para leer el código QR del punto de control.
          </ThemedText>

          {permission.canAskAgain ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Permitir el acceso a la cámara"
              onPress={() => {
                void requestPermission();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Permitir cámara
              </ThemedText>
            </Pressable>
          ) : Platform.OS === 'web' ? (
            <ThemedText type="small" themeColor="textSecondary">
              Habilite la cámara desde la configuración del navegador y recargue la
              página.
            </ThemedText>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir los ajustes del dispositivo"
              onPress={openSettings}
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Abrir ajustes
              </ThemedText>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a la ronda"
            onPress={goBack}
            style={styles.secondaryButton}>
            <ThemedText type="smallBold">Volver a la ronda</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isBusy = phase === 'locating' || phase === 'sending';

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchEnabled}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          phase === 'scanning'
            ? (scan) => {
                void handleBarcodeScanned(scan);
              }
            : undefined
        }
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <SafeAreaView style={styles.overlaySafeArea} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar el escáner"
              hitSlop={8}
              onPress={goBack}
              style={styles.iconButton}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                ✕
              </ThemedText>
            </Pressable>

            <ThemedText type="smallBold" style={styles.onAccent}>
              Escanear checkpoint
            </ThemedText>

            {Platform.OS === 'web' ? (
              <View style={styles.iconButton} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  torchEnabled ? 'Apagar la linterna' : 'Encender la linterna'
                }
                accessibilityState={{ selected: torchEnabled }}
                hitSlop={8}
                onPress={() => {
                  setTorchEnabled((current) => !current);
                }}
                style={[
                  styles.iconButton,
                  torchEnabled ? styles.iconButtonActive : null,
                ]}>
                <ThemedText type="smallBold" style={styles.onAccent}>
                  ☀
                </ThemedText>
              </Pressable>
            )}
          </View>

          <View style={styles.centerArea} pointerEvents="none">
            <View style={styles.scanFrame} />
            <ThemedText type="small" style={styles.hintText}>
              Apunte al código QR del punto de control
            </ThemedText>
          </View>

          <View style={styles.bottomArea} pointerEvents="none">
            {isBusy ? (
              <View style={styles.busyCard}>
                <ActivityIndicator color="#FFFFFF" />
                <ThemedText type="smallBold" style={styles.onAccent}>
                  {phase === 'locating'
                    ? 'Obteniendo su ubicación…'
                    : 'Validando y registrando…'}
                </ThemedText>
              </View>
            ) : (
              <ThemedText type="small" style={styles.footerHint}>
                La marcación se valida con su ubicación GPS.
              </ThemedText>
            )}
          </View>
        </SafeAreaView>
      </View>

      {phase === 'success' && result ? (
        <ResultOverlay
          variant="success"
          title={result.round_completed ? '¡Ronda completada!' : 'Checkpoint registrado'}
          message={[
            `${result.checkpoint.name} · a ${Math.round(result.distance_m)} m del punto.`,
            result.checkpoint.elapsed_seconds !== null
              ? `Tiempo acumulado: ${formatClock(result.checkpoint.elapsed_seconds)}`
              : null,
            result.checkpoint.segment_seconds !== null
              ? `Tramo desde la última marca: ${formatClock(result.checkpoint.segment_seconds)}`
              : null,
            result.round_completed
              ? '¡Felicidades! Marcaste todos los checkpoints de la ronda.'
              : `Quedan ${result.remaining_checkpoints} puntos pendientes.`,
          ]
            .filter(Boolean)
            .join('\n')}>
          {result.round_completed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver a la ronda completada"
              onPress={goBack}
              style={styles.primaryButton}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Ver resumen de la ronda
              </ThemedText>
            </Pressable>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Escanear otro checkpoint"
                onPress={resetScanner}
                style={styles.primaryButton}>
                <ThemedText type="smallBold" style={styles.onAccent}>
                  Escanear otro
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Volver a la ronda"
                onPress={goBack}
                style={styles.secondaryButtonDark}>
                <ThemedText type="smallBold" style={styles.onAccent}>
                  Volver a la ronda
                </ThemedText>
              </Pressable>
            </>
          )}
        </ResultOverlay>
      ) : null}

      {phase === 'error' && errorMessage ? (
        <ResultOverlay
          variant="error"
          title={
            isExpired ? 'Ronda cancelada por inactividad' : 'No se pudo registrar'
          }
          message={errorMessage}>
          {canOpenSettings && Platform.OS !== 'web' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir los ajustes del dispositivo"
              onPress={openSettings}
              style={styles.primaryButton}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Abrir ajustes
              </ThemedText>
            </Pressable>
          ) : null}

          {isExpired ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reintentar el escaneo"
              onPress={resetScanner}
              style={styles.primaryButton}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Reintentar
              </ThemedText>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a la ronda"
            onPress={goBack}
            style={isExpired ? styles.primaryButton : styles.secondaryButtonDark}>
            <ThemedText type="smallBold" style={styles.onAccent}>
              Volver a la ronda
            </ThemedText>
          </Pressable>
        </ResultOverlay>
      ) : null}
    </View>
  );
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  overlaySafeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  iconButtonActive: {
    backgroundColor: ACCENT,
  },
  centerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  scanFrame: {
    width: 240,
    height: 240,
    maxWidth: '80%',
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.85)',
  },
  hintText: {
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  bottomArea: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  footerHint: {
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  permissionLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    backgroundColor: '#000000',
  },
  fallbackContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  fallbackSafeArea: {
    flex: 1,
    maxWidth: 480,
    justifyContent: 'center',
    gap: Spacing.three,
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: Spacing.three,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#8A8F98',
    borderRadius: Spacing.three,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
  },
  secondaryButtonDark: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: Spacing.three,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
  },
  onAccent: {
    color: '#FFFFFF',
  },
  resultOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1C1F24',
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  resultIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    textAlign: 'center',
  },
  resultMessage: {
    color: '#D7DCE3',
    textAlign: 'center',
  },
  resultActions: {
    width: '100%',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});

