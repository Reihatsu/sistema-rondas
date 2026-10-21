/**
 * Escaneo del código QR de un checkpoint con validación GPS.
 *
 * Flujo: permiso de cámara → lectura del QR → ubicación actual → marcación en
 * la API. El backend es la autoridad final: valida el código, la geovalla y
 * los duplicados, y devuelve mensajes en español que se muestran al guardia.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { checkIn, getActiveRound, listRoundCheckpoints } from '@/api/rounds';
import type { CheckInResult } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOfflineQueue } from '@/hooks/use-offline-queue';
import {
  cacheRoundCheckpoints,
  getCachedRoundCheckpoints,
  type CachedRoundCheckpoint,
} from '@/services/checkpointCache';
import {
  getCurrentCoordinates,
  LocationError,
  type CurrentCoordinates,
} from '@/services/location';
import { isNetworkRequestError } from '@/services/offlineQueue';
import { formatClock } from '@/utils/datetime';

const ACCENT = '#208AEF';
const SUCCESS = '#1E7F4F';
const DANGER = '#D93025';
const WARNING = '#B26A00';

type Phase = 'scanning' | 'locating' | 'sending' | 'success' | 'error' | 'queued';

function ResultOverlay({
  variant,
  title,
  message,
  children,
}: {
  variant: 'success' | 'error' | 'queued';
  title: string;
  message: string;
  children: ReactNode;
}) {
  const isSuccess = variant === 'success';
  const isQueued = variant === 'queued';
  const backgroundColor = isSuccess ? SUCCESS : isQueued ? WARNING : DANGER;

  return (
    <View style={styles.resultOverlay}>
      <View style={styles.resultCard}>
        <View style={[styles.resultIcon, { backgroundColor }]}>
          <ThemedText type="smallBold" style={styles.onAccent}>
            {isSuccess ? '✓' : isQueued ? '⟳' : '!'}
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
  const { roundId: rawRoundId, from: rawFrom } = useLocalSearchParams<{
    roundId?: string | string[];
    from?: string | string[];
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const { enqueue: queueCheckIn, isOnline, pendingCount } = useOfflineQueue();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuedCheckpoint, setQueuedCheckpoint] = useState<string | null>(null);
  const [cachedCheckpoints, setCachedCheckpoints] = useState<CachedRoundCheckpoint[]>([]);
  const [isExpired, setIsExpired] = useState(false);
  const [canOpenSettings, setCanOpenSettings] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [timerBase, setTimerBase] = useState<{
    elapsed: number;
    at: number;
    running: boolean;
  } | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const busyRef = useRef(false);

  const roundIdText = Array.isArray(rawRoundId) ? rawRoundId[0] : rawRoundId;
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  const roundId = Number(roundIdText);
  const hasValidRound = Number.isInteger(roundId) && roundId > 0;

  const goBack = useCallback(() => {
    // Cuando la ronda se inició desde el Inicio, el escáner está encima de esa
    // pantalla: se reemplaza por la vista activa para no volver al Inicio y
    // dejar la ronda recién creada sin una pantalla de control. Se envía el id
    // para que `/rondas` pueda mostrar el resumen si la ronda ya se completó.
    if (from === 'home') {
      router.replace({
        pathname: '/rondas',
        params: hasValidRound ? { roundId: String(roundId) } : {},
      });
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/rondas');
  }, [from, hasValidRound, roundId, router]);

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
    setQueuedCheckpoint(null);
    setIsExpired(false);
    setCanOpenSettings(false);
    setPhase('scanning');
  }, []);

  // Cronómetro del escáner: parte del tiempo que calcula el backend y avanza
  // solo mientras la ronda está en curso.
  useEffect(() => {
    if (!hasValidRound) {
      return;
    }

    let cancelled = false;

    void getActiveRound()
      .then((active) => {
        if (cancelled || !active || active.id !== roundId) {
          return;
        }

        setTimerBase({
          elapsed: active.elapsed_seconds,
          at: Date.now(),
          running: active.status === 'IN_PROGRESS',
        });
        setTick(Date.now());
      })
      .catch(() => {
        // El escaneo sigue disponible aunque falle la consulta del cronómetro.
      });

    return () => {
      cancelled = true;
    };
  }, [hasValidRound, roundId]);

  useEffect(() => {
    if (!timerBase?.running) {
      return;
    }

    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timerBase]);

  // La caché permite asociar el QR con su checkpoint aunque el escáner se
  // abra sin señal. Si hay conexión se actualiza con los datos del servidor.
  useEffect(() => {
    if (!hasValidRound) {
      return;
    }

    let cancelled = false;

    void getCachedRoundCheckpoints(roundId).then((items) => {
      if (!cancelled && items.length > 0) {
        setCachedCheckpoints(items);
      }
    });

    if (isOnline) {
      void listRoundCheckpoints(roundId)
        .then((items) => {
          if (cancelled) {
            return;
          }

          setCachedCheckpoints(
            items.map((item) => ({
              id: item.id,
              name: item.name,
              code: item.code.trim().toUpperCase(),
            })),
          );
          void cacheRoundCheckpoints(roundId, items);
        })
        .catch(() => {
          // Sin red se conserva la última copia local disponible.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [hasValidRound, isOnline, roundId]);

  const checkpointByCode = useMemo(
    () =>
      new Map(
        cachedCheckpoints.map((checkpoint) => [
          checkpoint.code.trim().toUpperCase(),
          checkpoint,
        ]),
      ),
    [cachedCheckpoints],
  );

  const liveElapsed = timerBase
    ? timerBase.elapsed +
      (timerBase.running ? Math.floor((tick - timerBase.at) / 1000) : 0)
    : null;

  const saveCheckInForLater = useCallback(
    async (
      code: string,
      coordinates: CurrentCoordinates,
      checkpoint: CachedRoundCheckpoint | undefined,
      timestamp: string,
    ) => {
      const item = await queueCheckIn({
        round_id: roundId,
        checkpoint_id: checkpoint?.id ?? null,
        checkpoint_name: checkpoint?.name ?? code,
        qr_code: code,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        timestamp,
      });

      setQueuedCheckpoint(item.checkpoint_name);
      setPhase('queued');
    },
    [queueCheckIn, roundId],
  );

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
        const timestamp = new Date().toISOString();
        let checkpoint = checkpointByCode.get(code.trim().toUpperCase());

        // Si el efecto de caché aún no terminó (o la app se abrió offline),
        // se intenta resolver el checkpoint directamente desde AsyncStorage.
        if (!checkpoint) {
          const cached = await getCachedRoundCheckpoints(roundId);
          checkpoint = cached.find(
            (item) => item.code.trim().toUpperCase() === code.trim().toUpperCase(),
          );

          if (checkpoint) {
            setCachedCheckpoints(cached);
          }
        }

        setPhase('sending');

        // Si NetInfo ya confirma que no hay red, no se esperan 15 segundos al
        // timeout de Axios: la marcación se guarda directamente.
        if (!isOnline) {
          await saveCheckInForLater(code, coordinates, checkpoint, timestamp);
          return;
        }

        try {
          const response = await checkIn(roundId, {
            qr_code: code,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            timestamp,
          });

          setResult(response);
          setTimerBase({
            elapsed: response.round_elapsed_seconds,
            at: Date.now(),
            running: response.round_status === 'IN_PROGRESS',
          });
          setTick(Date.now());
          setPhase('success');
        } catch (requestError) {
          if (isNetworkRequestError(requestError)) {
            await saveCheckInForLater(code, coordinates, checkpoint, timestamp);
            return;
          }

          throw requestError;
        }
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
          setTimerBase((current) =>
            current ? { ...current, running: false } : current,
          );
          Alert.alert('Ronda cancelada por inactividad', message);
        }
      } finally {
        busyRef.current = false;
      }
    },
    [checkpointByCode, hasValidRound, isOnline, roundId, saveCheckInForLater],
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
            {liveElapsed !== null ? (
              <View style={styles.timerCard}>
                <ThemedText type="code" style={styles.footerHint}>
                  TIEMPO DE RONDA
                </ThemedText>
                <ThemedText type="subtitle" style={styles.onAccent}>
                  {formatClock(liveElapsed)}
                </ThemedText>
              </View>
            ) : null}

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
      {phase === 'queued' ? (
        <ResultOverlay
          variant="queued"
          title="Marcación guardada sin conexión"
          message={[
            `${queuedCheckpoint ?? 'El punto escaneado'} quedó guardado en este dispositivo.`,
            'Se enviará automáticamente cuando vuelva la conexión; el servidor validará entonces la ubicación.',
            pendingCount === 1
              ? 'Hay 1 punto pendiente de sincronizar.'
              : pendingCount > 1
                ? `Hay ${pendingCount} puntos pendientes de sincronizar.`
                : 'Consulte el estado de sincronización en la pantalla de Inicio.',
          ].join('\n')}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Escanear otro checkpoint"
            onPress={resetScanner}
            style={styles.primaryButton}>
            <ThemedText type="smallBold" style={styles.onAccent}>
              Seguir escaneando
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  timerCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
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

