/**
 * Pantalla operativa del guardia: ronda activa, cronómetro y checkpoints.
 *
 * Ciclo de vida cubierto:
 * - Cronómetro en tiempo real (se detiene al pausar y se restaura al reanudar).
 * - Pausa con motivo obligatorio, reanudación, comentarios y cancelación.
 * - Checkpoints PENDING/COMPLETED con tiempo acumulado y tiempo de tramo.
 * - Cierre automático de la ronda al marcar el último punto (lo hace el
 *   backend) y alerta si la ronda se canceló por inactividad.
 *
 * Se recarga al volver del escáner (`useFocusEffect`) para reflejar los puntos
 * recién visitados sin reiniciar la aplicación.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import {
  addRoundComment,
  cancelRound,
  checkIn,
  getActiveRound,
  getRound,
  listRoundCheckpoints,
  pauseRound,
  resumeRound,
  startNewRound,
} from '@/api/rounds';
import type {
  PointType,
  RoundCheckpoint,
  RoundDetail,
  RoundStatus,
} from '@/api/types';
import { CommentPromptModal } from '@/components/comment-prompt-modal';
import { CompanyPicker } from '@/components/company-picker';
import { InactivityWarning, RoundTimer } from '@/components/round-timer';
import { OfflineQueueBanner } from '@/components/offline-queue-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useOfflineQueue } from '@/hooks/use-offline-queue';
import { useTheme } from '@/hooks/use-theme';
import { cacheRoundCheckpoints } from '@/services/checkpointCache';
import { getCurrentCoordinates, type CurrentCoordinates } from '@/services/location';
import { startNfcTagListener, type NfcTagListener, type NfcTagRead } from '@/services/nfc';
import { canonicalNfcText, describeNfcTagFailure, findCheckpointByNfcTag } from '@/services/nfcTag';
import { isNetworkRequestError } from '@/services/offlineQueue';
import { formatClock, formatDuration, formatTime, secondsUntil } from '@/utils/datetime';

const ACCENT = '#208AEF';
const SUCCESS = '#1E7F4F';
const DANGER = '#D93025';
const WARNING = '#B26A00';

/** Debe coincidir con `ROUND_INACTIVITY_TIMEOUT_MINUTES` del backend. */
const INACTIVITY_TIMEOUT_MINUTES = 20;
/** Se avisa al guardia cuando queda menos de este tiempo. */
const INACTIVITY_WARNING_SECONDS = 5 * 60;

const EXPIRED_MESSAGE = `La ronda fue cancelada automáticamente por inactividad: transcurrieron más de ${INACTIVITY_TIMEOUT_MINUTES} minutos sin marcaciones.`;

const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  PAUSED: 'Pausada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const ROUND_STATUS_COLORS: Record<RoundStatus, string> = {
  PENDING: WARNING,
  IN_PROGRESS: ACCENT,
  PAUSED: WARNING,
  COMPLETED: SUCCESS,
  CANCELLED: DANGER,
};

type PromptKind = 'pause' | 'cancel' | 'comment';
type BusyAction = 'none' | 'starting' | 'pausing' | 'resuming' | 'cancelling' | 'commenting';
type NfcReaderStatus = 'idle' | 'starting' | 'listening' | 'error';
type NfcFeedbackTone = 'info' | 'success' | 'error';

interface NfcFeedback {
  tone: NfcFeedbackTone;
  message: string;
}

function isInactivityMessage(message: string): boolean {
  return /inactividad/i.test(message);
}

function CheckpointRow({
  checkpoint,
  index,
}: {
  checkpoint: RoundCheckpoint;
  index: number;
}) {
  const theme = useTheme();
  const visited = checkpoint.status === 'COMPLETED' || checkpoint.is_visited;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: visited ? SUCCESS : theme.backgroundSelected,
        },
      ]}>
      <View
        style={[
          styles.indexBadge,
          { backgroundColor: visited ? SUCCESS : theme.backgroundSelected },
        ]}>
        <ThemedText type="smallBold" style={visited ? styles.onAccent : undefined}>
          {visited ? '✓' : index + 1}
        </ThemedText>
      </View>

      <View style={styles.rowBody}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {checkpoint.name}
        </ThemedText>

        {checkpoint.location_description ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {checkpoint.location_description}
          </ThemedText>
        ) : null}

        <View style={styles.rowMeta}>
          <ThemedText type="code" themeColor="textSecondary">
            {checkpoint.code}
          </ThemedText>

          {visited && checkpoint.elapsed_seconds !== null ? (
            <ThemedText type="code" themeColor="textSecondary">
              {formatClock(checkpoint.elapsed_seconds)} acumulado
            </ThemedText>
          ) : null}

          {visited && checkpoint.segment_seconds !== null ? (
            <ThemedText type="code" themeColor="textSecondary">
              tramo {formatClock(checkpoint.segment_seconds)}
            </ThemedText>
          ) : null}

          {visited && checkpoint.visited_at ? (
            <ThemedText type="code" themeColor="textSecondary">
              {formatTime(checkpoint.visited_at)}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <View
        style={[
          styles.chip,
          { backgroundColor: visited ? SUCCESS : theme.backgroundSelected },
        ]}>
        <ThemedText type="small" style={visited ? styles.onAccent : undefined}>
          {visited ? 'Listo' : 'Pendiente'}
        </ThemedText>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const textColor = isPrimary ? '#FFFFFF' : isDanger ? DANGER : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          borderColor: isPrimary
            ? ACCENT
            : isDanger
              ? DANGER
              : theme.backgroundSelected,
          backgroundColor: isPrimary ? ACCENT : theme.backgroundElement,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: textColor }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

export default function RondasScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { roundId: rawFinishedRoundId } = useLocalSearchParams<{
    roundId?: string | string[];
  }>();

  const finishedRoundIdParam = Number(
    Array.isArray(rawFinishedRoundId) ? rawFinishedRoundId[0] : rawFinishedRoundId,
  );

  /** Empresas activas asignadas al guardia; cada ronda pertenece a una sola. */
  const companies = useMemo(
    () => (user?.companies ?? []).filter((company) => company.is_active),
    [user],
  );

  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [finishedRound, setFinishedRound] = useState<RoundDetail | null>(null);
  const [checkpoints, setCheckpoints] = useState<RoundCheckpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>('none');
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [nfcReaderStatus, setNfcReaderStatus] = useState<NfcReaderStatus>('idle');
  const [nfcFeedback, setNfcFeedback] = useState<NfcFeedback | null>(null);
  const [nfcRetryToken, setNfcRetryToken] = useState(0);

  const { enqueue: queueCheckIn, isOnline } = useOfflineQueue();

  // Referencias estables para que el lector NFC no se reinicie cada vez que
  // cambian los checkpoints o el estado de la ronda.
  const roundRef = useRef<RoundDetail | null>(null);
  const checkpointsRef = useRef<RoundCheckpoint[]>([]);
  const nfcSubmittingRef = useRef(false);
  /**
   * Última etiqueta procesada. La clave es el texto NDEF (o el UID si la
   * etiqueta no tiene texto) para no repetir el mismo aviso mientras la
   * etiqueta sigue apoyada sobre el lector.
   */
  const lastNfcTagRef = useRef<{ key: string; at: number } | null>(null);

  // Base del cronómetro: tiempo del backend + instante local de sincronización.
  const timerBaseRef = useRef<{ elapsed: number; at: number } | null>(null);
  const hasLoadedRef = useRef(false);
  const lastRoundIdRef = useRef<number | null>(null);
  const requestedFinishedRoundIdRef = useRef<number | null>(
    Number.isInteger(finishedRoundIdParam) && finishedRoundIdParam > 0
      ? finishedRoundIdParam
      : null,
  );
  const expiredAlertRef = useRef<number | null>(null);

  const syncTimer = useCallback((value: RoundDetail | null) => {
    timerBaseRef.current = value
      ? { elapsed: value.elapsed_seconds ?? 0, at: Date.now() }
      : null;
    setTick(Date.now());
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);

      try {
        const active = await getActiveRound();

        // El backend devuelve la ronda ya cancelada cuando detecta que superó
        // los 20 minutos de inactividad: se avisa una sola vez al guardia.
        if (active && active.status === 'CANCELLED') {
          setRound(null);
          setCheckpoints([]);
          setFinishedRound(null);
          lastRoundIdRef.current = null;
          syncTimer(null);
          setError(EXPIRED_MESSAGE);

          if (expiredAlertRef.current !== active.id) {
            expiredAlertRef.current = active.id;
            Alert.alert('Ronda cancelada por inactividad', EXPIRED_MESSAGE);
          }
          return;
        }

        if (!active) {
          setRound(null);
          setCheckpoints([]);
          syncTimer(null);

          // Si acabamos de cerrar una ronda, se muestra la pantalla de cierre
          // (felicitación o motivo de cancelación) en lugar de un vacío. El
          // identificador puede venir del escáner abierto desde el Inicio.
          const previousId =
            lastRoundIdRef.current ?? requestedFinishedRoundIdRef.current;
          lastRoundIdRef.current = null;
          requestedFinishedRoundIdRef.current = null;

          if (previousId !== null) {
            try {
              const previous = await getRound(previousId);
              if (
                previous.status === 'COMPLETED' ||
                previous.status === 'CANCELLED'
              ) {
                setFinishedRound(previous);
              }
            } catch {
              setFinishedRound(null);
            }
          } else {
            // Sin cierre reciente: no se mantiene una felicitación antigua.
            setFinishedRound(null);
          }

          return;
        }

        const items = await listRoundCheckpoints(active.id);
        void cacheRoundCheckpoints(active.id, items);
        setFinishedRound(null);
        setRound(active);
        syncTimer(active);
        setCheckpoints(items);
        lastRoundIdRef.current = active.id;
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        hasLoadedRef.current = true;
      }
    },
    [syncTimer],
  );

  // Al volver del escáner se recarga en silencio para actualizar los estados.
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      void load(hasLoadedRef.current ? 'refresh' : 'initial');

      return () => {
        // Evita que el lector siga activo al abrir otra pantalla encima.
        setIsScreenFocused(false);
      };
    }, [load]),
  );

  // Las referencias permiten que el callback NFC use siempre los últimos datos
  // sin reiniciar la sesión del lector en cada marcación.
  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    checkpointsRef.current = checkpoints;
  }, [checkpoints]);

  // El cronómetro avanza cada segundo solo mientras la ronda está en curso.
  useEffect(() => {
    if (!round || round.status !== 'IN_PROGRESS') {
      return;
    }

    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [round]);

  // La selección debe apuntar siempre a una empresa vigente del guardia.
  useEffect(() => {
    setSelectedCompanyId((current) => {
      if (current !== null && companies.some((company) => company.id === current)) {
        return current;
      }

      return companies[0]?.id ?? null;
    });
  }, [companies]);

  // Con una ronda abierta la empresa la fija la ronda, no el selector.
  useEffect(() => {
    if (round?.company_id !== undefined) {
      setSelectedCompanyId(round.company_id);
    }
  }, [round?.company_id]);

  const applyRound = useCallback(
    (updated: RoundDetail) => {
      setRound(updated);
      setFinishedRound(null);
      syncTimer(updated);
    },
    [syncTimer],
  );

  const total = checkpoints.length;
  const visited = checkpoints.filter((checkpoint) => checkpoint.is_visited).length;
  const allVisited = total > 0 && visited === total;
  const isInProgress = round?.status === 'IN_PROGRESS';
  const isPaused = round?.status === 'PAUSED';
  const isCompleted = round?.status === 'COMPLETED';
  const isCancelled = round?.status === 'CANCELLED';
  const canScan = Boolean(round && isInProgress && total > 0 && !allVisited);
  const progressPercent = total > 0 ? Math.round((visited / total) * 100) : 0;

  const selectedCompany =
    companies.find((company) => company.id === selectedCompanyId) ??
    companies[0] ??
    null;

  /**
   * Tecnología de los puntos con la que debe abrirse el escáner. La empresa de
   * la ronda activa manda; si aún no se cargó la ronda, se usan los puntos y la
   * empresa seleccionada para iniciarla.
   */
  const scanPointType: PointType =
    round?.company?.point_type ??
    checkpoints.find((checkpoint) => checkpoint.point_type)?.point_type ??
    selectedCompany?.point_type ??
    'QR';

  /**
   * Procesa una etiqueta leída en modo pasivo y reutiliza exactamente el mismo
   * flujo de marcación que el escáner QR (API + cola offline).
   *
   * La etiqueta se identifica por el **texto NDEF**, que debe ser el código del
   * punto (`NFC-EMP2-PT03`). El UID se valida además contra el registrado en el
   * punto: si cualquiera de los dos no coincide, se muestra un error indicando
   * cuál falló. El GPS es opcional en NFC, por lo que un fallo de ubicación no
   * impide registrar la visita.
   */
  const handleNfcTag = useCallback(
    async (tag: NfcTagRead) => {
      if (nfcSubmittingRef.current) {
        return;
      }

      const currentRound = roundRef.current;

      if (!currentRound || currentRound.status !== 'IN_PROGRESS') {
        return;
      }

      const match = findCheckpointByNfcTag(tag, checkpointsRef.current);

      if (!match.ok) {
        console.warn(
          `[rondas] Etiqueta NFC rechazada (${match.reason}):`,
          match.text || '(sin texto NDEF)',
          match.uid,
        );
        Vibration.vibrate([0, 80, 60, 80]);
        setNfcFeedback({
          tone: 'error',
          message: describeNfcTagFailure(match),
        });
        return;
      }

      const checkpoint = match.checkpoint;
      const nfcUid = match.uid;
      // Se envía el código canónico del punto: es el mismo valor que el texto
      // NDEF validado y el que el backend resuelve contra `checkpoints.code`.
      const nfcCode = checkpoint.code;

      if (checkpoint.is_visited) {
        Vibration.vibrate(120);
        setNfcFeedback({
          tone: 'info',
          message: `${checkpoint.name} ya fue marcado. Acérquese al siguiente punto.`,
        });
        return;
      }

      nfcSubmittingRef.current = true;
      Vibration.vibrate(60);
      setNfcFeedback({
        tone: 'info',
        message: `Etiqueta leída: ${checkpoint.name} (${nfcCode}). Registrando marcación…`,
      });

      // El NFC no depende del GPS; si el permiso o el servicio fallan, se envía
      // la marcación sin coordenadas para no bloquear al guardia.
      let coordinates: CurrentCoordinates | null = null;
      try {
        coordinates = await getCurrentCoordinates();
      } catch (locationError) {
        console.warn('[rondas] NFC sin coordenadas:', locationError);
      }

      try {
        const timestamp = new Date().toISOString();
        const queueForLater = async () => {
          await queueCheckIn({
            round_id: currentRound.id,
            checkpoint_id: checkpoint.id,
            checkpoint_name: checkpoint.name,
            nfc_code: nfcCode,
            nfc_uid: nfcUid,
            latitude: coordinates?.latitude ?? null,
            longitude: coordinates?.longitude ?? null,
            timestamp,
          });

          Vibration.vibrate([0, 60, 60, 60]);
          setNfcFeedback({
            tone: 'success',
            message: `${checkpoint.name}: marcación guardada en la cola offline. Se enviará automáticamente al recuperar la conexión.`,
          });
        };

        if (!isOnline) {
          await queueForLater();
          return;
        }

        try {
          const response = await checkIn(currentRound.id, {
            nfc_code: nfcCode,
            nfc_uid: nfcUid,
            latitude: coordinates?.latitude ?? null,
            longitude: coordinates?.longitude ?? null,
            timestamp,
          });

          Vibration.vibrate([0, 60, 60, 60]);
          setNfcFeedback({
            tone: 'success',
            message: response.round_completed
              ? `¡Ronda completada! ${checkpoint.name} fue el último punto.`
              : `${checkpoint.name}: ${response.message}`,
          });

          await load('refresh');
        } catch (requestError) {
          if (!isNetworkRequestError(requestError)) {
            throw requestError;
          }

          await queueForLater();
        }
      } catch (tagError) {
        Vibration.vibrate([0, 120, 80, 120]);
        setNfcFeedback({ tone: 'error', message: getErrorMessage(tagError) });
      } finally {
        nfcSubmittingRef.current = false;
      }
    },
    [isOnline, load, queueCheckIn],
  );

  // Lector NFC pasivo: permanece activo mientras la ronda está en curso y la
  // pantalla tiene el foco. El guardia solo acerca el móvil a la etiqueta.
  useEffect(() => {
    if (!isInProgress || !isScreenFocused || scanPointType !== 'NFC' || !canScan) {
      setNfcReaderStatus('idle');
      return;
    }

    let cancelled = false;
    let listener: NfcTagListener | null = null;

    setNfcReaderStatus('starting');
    setNfcFeedback(null);

    void startNfcTagListener(
      (tag) => {
        if (cancelled) {
          return;
        }

        const now = Date.now();
        const previous = lastNfcTagRef.current;
        // La misma etiqueta puede notificarse varias veces si se deja apoyada
        // sobre el lector; se ignora durante unos segundos. La clave es el
        // texto NDEF (identificador principal) y, si no lo hay, el UID, para
        // que el aviso de "sin texto NDEF" no se repita en bucle.
        const key = canonicalNfcText(tag.text) || tag.uid;

        if (previous?.key === key && now - previous.at < 3000) {
          return;
        }

        lastNfcTagRef.current = { key, at: now };
        void handleNfcTag(tag);
      },
      {
        alertMessage: 'Acerque el móvil a la etiqueta NFC del punto de control',
      },
    )
      .then((activeListener) => {
        if (cancelled) {
          void activeListener.stop();
          return;
        }

        listener = activeListener;
        setNfcReaderStatus('listening');
      })
      .catch((readerError: unknown) => {
        if (cancelled) {
          return;
        }

        setNfcReaderStatus('error');
        setNfcFeedback({
          tone: 'error',
          message: getErrorMessage(readerError),
        });
      });

    return () => {
      cancelled = true;
      void listener?.stop();
    };
  }, [canScan, handleNfcTag, isInProgress, isScreenFocused, nfcRetryToken, scanPointType]);

  const timerBase = timerBaseRef.current;
  const elapsedSeconds = round
    ? timerBase
      ? timerBase.elapsed +
        (isInProgress ? Math.floor((tick - timerBase.at) / 1000) : 0)
      : round.elapsed_seconds
    : 0;

  const inactivityRemaining =
    isInProgress && round?.inactivity_deadline
      ? secondsUntil(round.inactivity_deadline)
      : null;

  const nfcToneColor =
    nfcReaderStatus === 'error' || nfcFeedback?.tone === 'error'
      ? DANGER
      : nfcReaderStatus === 'listening'
        ? ACCENT
        : theme.textSecondary;

  const nfcStatusLabel =
    nfcReaderStatus === 'starting'
      ? 'Iniciando lector NFC…'
      : nfcReaderStatus === 'error'
        ? 'No se pudo activar el lector NFC'
        : nfcReaderStatus === 'listening'
          ? 'Lector NFC activo: acerque el móvil a la etiqueta'
          : allVisited
            ? 'Ronda completa'
            : total === 0
              ? 'Esta ronda no tiene puntos de control'
              : 'Lector NFC inactivo';

  const handleActionError = useCallback(
    (actionError: unknown): string => {
      const message = getErrorMessage(actionError);

      if (isInactivityMessage(message)) {
        setPrompt(null);
        Alert.alert('Ronda cancelada por inactividad', message);
        void load('refresh');
      }

      return message;
    },
    [load],
  );


  function openScanner() {
    // El modo NFC es pasivo: no abre otra pantalla, el lector ya está activo.
    if (!round || !canScan || scanPointType !== 'QR') {
      return;
    }

    router.push({
      pathname: '/scan',
      params: {
        roundId: String(round.id),
        pointType: scanPointType,
      },
    });
  }

  function openHistory() {
    // `Href` evita depender del archivo generado de rutas tipadas de Expo.
    router.push('/historial' as Href);
  }

  function goHome() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  }

  function openPrompt(kind: PromptKind) {
    setPromptError(null);
    setPrompt(kind);
  }

  function closePrompt() {
    if (busyAction === 'none') {
      setPrompt(null);
      setPromptError(null);
    }
  }

  async function handleStartNewRound() {
    if (busyAction !== 'none') {
      return;
    }

    setBusyAction('starting');
    setError(null);

    try {
      const created = await startNewRound(selectedCompanyId ?? undefined);
      const createdPointType = created.company?.point_type ?? scanPointType;

      // La ronda ya está en curso: se pinta de inmediato para que el
      // cronómetro arranque aunque la consulta de checkpoints tarde.
      setFinishedRound(null);
      setRound(created);
      syncTimer(created);
      lastRoundIdRef.current = created.id;
      setSelectedCompanyId(created.company_id);

      try {
        const items = await listRoundCheckpoints(created.id);
        void cacheRoundCheckpoints(created.id, items);
        setCheckpoints(items);
      } catch {
        setCheckpoints([]);
      }

      // En NFC el lector pasivo de esta misma pantalla toma el control cuando
      // los checkpoints terminan de cargarse: no se navega a `/scan`.
      if (createdPointType === 'NFC') {
        return;
      }

      router.push({
        pathname: '/scan',
        params: {
          roundId: String(created.id),
          from: 'rounds',
          pointType: 'QR',
        },
      });
    } catch (startError) {
      const message = getErrorMessage(startError);

      // El backend rechaza la creación si el guardia ya tiene una ronda
      // abierta: se recarga para mostrar esa ronda en lugar de un error.
      if (/ronda/i.test(message) && /(en curso|pausada|#\d+)/i.test(message)) {
        await load('refresh');
      } else {
        setError(handleActionError(startError));
      }
    } finally {
      setBusyAction('none');
    }
  }

  async function handleResume() {
    if (!round || busyAction !== 'none') {
      return;
    }

    setBusyAction('resuming');
    setError(null);

    try {
      const updated = await resumeRound(round.id);
      applyRound(updated);

      // Se recargan los puntos ya leídos para no perder el progreso.
      const items = await listRoundCheckpoints(updated.id);
      void cacheRoundCheckpoints(updated.id, items);
      setCheckpoints(items);
    } catch (resumeError) {
      setError(handleActionError(resumeError));
    } finally {
      setBusyAction('none');
    }
  }

  async function submitPrompt(text: string) {
    if (!round || prompt === null || busyAction !== 'none') {
      return;
    }

    const kind = prompt;
    setPromptError(null);
    setBusyAction(
      kind === 'pause' ? 'pausing' : kind === 'cancel' ? 'cancelling' : 'commenting',
    );

    try {
      if (kind === 'pause') {
        const updated = await pauseRound(round.id, text);
        applyRound(updated);
        setError(null);
      } else if (kind === 'cancel') {
        const updated = await cancelRound(round.id, text);
        applyRound(updated);
        setError(null);
      } else {
        const updated = await addRoundComment(round.id, text);
        applyRound(updated);
      }

      setPrompt(null);
    } catch (actionError) {
      const message = handleActionError(actionError);

      if (!isInactivityMessage(message)) {
        setPromptError(message);
      }
    } finally {
      setBusyAction('none');
    }
  }


  function renderBody() {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={ACCENT} size="large" />
          <ThemedText type="small" themeColor="textSecondary">
            Cargando su ronda…
          </ThemedText>
        </View>
      );
    }

    if (round) {
      return (
        <FlatList
          data={checkpoints}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => (
            <CheckpointRow checkpoint={item} index={index} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                void load('refresh');
              }}
              tintColor={ACCENT}
              colors={[ACCENT]}
            />
          }
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusChip,
                    { backgroundColor: ROUND_STATUS_COLORS[round.status] },
                  ]}>
                  <ThemedText type="smallBold" style={styles.onAccent}>
                    {ROUND_STATUS_LABELS[round.status] ?? round.status}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {visited} de {total} visitados
                </ThemedText>
              </View>

              <ThemedText type="subtitle" numberOfLines={2}>
                {round.company?.name ?? 'Mi ronda'}
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary">
                {scanPointType === 'NFC'
                  ? 'Puntos NFC: acerque el móvil a la etiqueta del punto.'
                  : 'Puntos QR: escanee el código y valide su ubicación GPS.'}
              </ThemedText>

              <RoundTimer
                elapsedSeconds={elapsedSeconds}
                isPaused={!isInProgress}
                caption={
                  isPaused
                    ? 'En pausa: el cronómetro está detenido.'
                    : isCompleted
                      ? 'Ronda completada: el cronómetro está detenido.'
                      : isCancelled
                        ? 'Ronda cancelada: el cronómetro está detenido.'
                        : 'En curso: el cronómetro avanza en tiempo real.'
                }
              />

              {inactivityRemaining !== null &&
              inactivityRemaining <= INACTIVITY_WARNING_SECONDS ? (
                <InactivityWarning
                  remainingSeconds={inactivityRemaining}
                  timeoutMinutes={INACTIVITY_TIMEOUT_MINUTES}
                />
              ) : null}

              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: theme.backgroundSelected },
                ]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progressPercent}%`,
                      backgroundColor: allVisited ? SUCCESS : ACCENT,
                    },
                  ]}
                />
              </View>


              {error ? (
                <View style={[styles.banner, { borderColor: DANGER }]}>
                  <ThemedText type="small" style={styles.dangerText}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              {isPaused ? (
                <View style={[styles.banner, { borderColor: WARNING }]}>
                  <ThemedText type="small" style={styles.warningText}>
                    Ronda pausada. Reanúdela para continuar el recorrido y el
                    cronómetro desde donde lo dejó.
                  </ThemedText>
                </View>
              ) : null}

              {isCompleted ? (
                <View style={[styles.banner, { borderColor: SUCCESS }]}>
                  <ThemedText type="smallBold" style={styles.successText}>
                    ¡Felicidades! Completaste todos los puntos de la ronda.
                  </ThemedText>
                  <ThemedText type="small" style={styles.successText}>
                    Tiempo total: {formatDuration(round.elapsed_seconds)}.
                  </ThemedText>
                </View>
              ) : null}

              {isCancelled ? (
                <View style={[styles.banner, { borderColor: DANGER }]}>
                  <ThemedText type="smallBold" style={styles.dangerText}>
                    Ronda cancelada
                  </ThemedText>
                  <ThemedText type="small" style={styles.dangerText}>
                    {round.cancel_reason ?? 'La ronda se cerró sin completar.'}
                  </ThemedText>
                </View>
              ) : null}

              <View style={styles.actionsRow}>
                {isInProgress ? (
                  <ActionButton
                    label="Pausar"
                    onPress={() => openPrompt('pause')}
                    disabled={busyAction !== 'none'}
                  />
                ) : null}

                {isPaused ? (
                  <ActionButton
                    label="Reanudar"
                    variant="primary"
                    onPress={() => {
                      void handleResume();
                    }}
                    loading={busyAction === 'resuming'}
                    disabled={busyAction !== 'none'}
                  />
                ) : null}

                {isInProgress || isPaused ? (
                  <ActionButton
                    label="Comentario"
                    onPress={() => openPrompt('comment')}
                    disabled={busyAction !== 'none'}
                  />
                ) : null}

                {isInProgress || isPaused ? (
                  <ActionButton
                    label="Cancelar"
                    variant="danger"
                    onPress={() => openPrompt('cancel')}
                    disabled={busyAction !== 'none'}
                  />
                ) : null}

                {isCompleted || isCancelled ? (
                  <ActionButton label="Ver historial" onPress={openHistory} />
                ) : null}
              </View>

              {round.observations ? (
                <View
                  style={[
                    styles.notes,
                    { backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText type="smallBold">
                    Comentarios y observaciones
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={8}>
                    {round.observations}
                  </ThemedText>
                </View>
              ) : null}

              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Puntos de control
              </ThemedText>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <ThemedText type="small" themeColor="textSecondary">
                Esta empresa no tiene puntos de control activos.
              </ThemedText>
            </View>
          }
        />
      );
    }


    if (finishedRound) {
      const completed = finishedRound.status === 'COMPLETED';

      return (
        <View style={styles.centered}>
          <ThemedView type="backgroundElement" style={styles.stateCard}>
            <ThemedText type="smallBold">
              {completed
                ? '¡Felicidades, ronda completada!'
                : 'La ronda quedó cancelada'}
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary">
              {completed
                ? `Completaste el recorrido en ${formatDuration(
                    finishedRound.elapsed_seconds,
                  )}. Todos los checkpoints quedaron registrados.`
                : finishedRound.cancel_reason ??
                  'La ronda se cerró sin completar el recorrido.'}
            </ThemedText>

            <View style={styles.finishedStats}>
              <ThemedText type="code" themeColor="textSecondary">
                {finishedRound.logs.length} marcaciones
              </ThemedText>
              <ThemedText type="code" themeColor="textSecondary">
                {formatDuration(finishedRound.elapsed_seconds)}
              </ThemedText>
            </View>

            {companies.length > 0 ? (
              <CompanyPicker
                companies={companies}
                selectedCompanyId={selectedCompanyId}
                onSelect={setSelectedCompanyId}
                disabled={busyAction !== 'none'}
                title="Empresa de la próxima ronda"
              />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No tiene una empresa activa asignada. Solicite al administrador que
                le asigne una empresa con puntos de control.
              </ThemedText>
            )}

            <ActionButton
              label="Iniciar Nueva Ronda"
              variant="primary"
              onPress={() => {
                void handleStartNewRound();
              }}
              loading={busyAction === 'starting'}
              disabled={busyAction !== 'none' || companies.length === 0}
            />
            <ActionButton
              label="Ver historial de rondas"
              onPress={openHistory}
            />
            <ActionButton label="Volver al inicio" onPress={goHome} />
          </ThemedView>
        </View>
      );
    }

    return (
      <View style={styles.centered}>
        <ThemedView type="backgroundElement" style={styles.stateCard}>
          <ThemedText type="smallBold">Sin ronda activa</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Inicie una ronda nueva para comenzar el recorrido. Se asignarán los
            checkpoints activos de la empresa seleccionada.
          </ThemedText>

          {companies.length > 0 ? (
            <CompanyPicker
              companies={companies}
              selectedCompanyId={selectedCompanyId}
              onSelect={setSelectedCompanyId}
              disabled={busyAction !== 'none'}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              No tiene una empresa activa asignada. Solicite al administrador que
              le asigne una empresa con puntos de control.
            </ThemedText>
          )}

          {error ? (
            <View style={[styles.banner, { borderColor: DANGER }]}>
              <ThemedText type="small" style={styles.dangerText}>
                {error}
              </ThemedText>
            </View>
          ) : null}

          <ActionButton
            label="Iniciar Nueva Ronda"
            variant="primary"
            onPress={() => {
              void handleStartNewRound();
            }}
            loading={busyAction === 'starting'}
            disabled={busyAction !== 'none' || companies.length === 0}
          />
          <ActionButton label="Ver historial de rondas" onPress={openHistory} />
          <ActionButton
            label="Actualizar"
            onPress={() => {
              void load('refresh');
            }}
          />
          <ActionButton label="Volver al inicio" onPress={goHome} />
        </ThemedView>
      </View>
    );
  }


  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver al inicio"
            hitSlop={8}
            onPress={goHome}>
            <ThemedText type="smallBold" style={styles.linkText}>
              ‹ Inicio
            </ThemedText>
          </Pressable>

          <ThemedText type="code" themeColor="textSecondary">
            MÓDULO GUARDIA
          </ThemedText>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir el historial de rondas"
            hitSlop={8}
            onPress={openHistory}>
            <ThemedText type="smallBold" style={styles.linkText}>
              Historial
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.offlineBanner}>
          <OfflineQueueBanner />
        </View>

        {renderBody()}

        {round && isInProgress && scanPointType === 'QR' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              allVisited ? 'Ronda completa' : 'Escanear checkpoint QR'
            }
            accessibilityState={{ disabled: !canScan }}
            disabled={!canScan}
            onPress={openScanner}
            style={({ pressed }) => [
              styles.fab,
              {
                backgroundColor: canScan ? ACCENT : theme.backgroundSelected,
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <ThemedText
              type="smallBold"
              style={canScan ? styles.onAccent : { color: theme.textSecondary }}>
              {allVisited
                ? 'Ronda completa'
                : total === 0
                  ? 'Sin puntos de control'
                  : 'Escanear Checkpoint (QR)'}
            </ThemedText>
          </Pressable>
        ) : null}

        {round && isInProgress && scanPointType === 'NFC' ? (
          // React Native 0.88 en Android rechaza `accessibilityRole="status"` y
          // cierra la app al montar esta vista. `accessibilityLiveRegion` anuncia
          // los cambios del lector sin usar un rol inválido.
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.fab,
              styles.nfcDock,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: nfcToneColor,
              },
            ]}>
            <View style={styles.nfcStatusRow}>
              {nfcReaderStatus === 'starting' ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : (
                <View
                  style={[styles.nfcDot, { backgroundColor: nfcToneColor }]}
                />
              )}
              <ThemedText
                type="smallBold"
                style={[styles.nfcStatusText, { color: nfcToneColor }]}>
                {nfcStatusLabel}
              </ThemedText>
            </View>

            {nfcFeedback ? (
              <ThemedText
                type="small"
                style={[
                  styles.nfcFeedback,
                  {
                    color:
                      nfcFeedback.tone === 'error'
                        ? DANGER
                        : nfcFeedback.tone === 'success'
                          ? SUCCESS
                          : theme.textSecondary,
                  },
                ]}>
                {nfcFeedback.message}
              </ThemedText>
            ) : null}

            {nfcReaderStatus === 'error' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reintentar lector NFC"
                onPress={() => setNfcRetryToken((value) => value + 1)}
                style={({ pressed }) => [
                  styles.nfcRetry,
                  { borderColor: DANGER, opacity: pressed ? 0.7 : 1 },
                ]}>
                <ThemedText type="smallBold" style={styles.dangerText}>
                  Reintentar lector
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isPaused ? (
          <View style={[styles.fab, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
              Ronda pausada — reanude para escanear
            </ThemedText>
          </View>
        ) : null}

        {prompt === 'pause' ? (
          <CommentPromptModal
            visible
            title="Pausar la ronda"
            description="El cronómetro se detendrá. Indique el motivo de la pausa (obligatorio)."
            label="MOTIVO DE LA PAUSA"
            placeholder="Ej.: Pausado por emergencia en el sector B"
            confirmLabel="Pausar ronda"
            isSubmitting={busyAction === 'pausing'}
            error={promptError}
            onCancel={closePrompt}
            onSubmit={(text) => {
              void submitPrompt(text);
            }}
          />
        ) : null}

        {prompt === 'cancel' ? (
          <CommentPromptModal
            visible
            title="Cancelar la ronda"
            description="La ronda se cerrará de forma definitiva. Indique el motivo (obligatorio)."
            label="MOTIVO DE LA CANCELACIÓN"
            placeholder="Ej.: Evacuación del edificio por emergencia"
            confirmLabel="Cancelar ronda"
            destructive
            isSubmitting={busyAction === 'cancelling'}
            error={promptError}
            onCancel={closePrompt}
            onSubmit={(text) => {
              void submitPrompt(text);
            }}
          />
        ) : null}

        {prompt === 'comment' ? (
          <CommentPromptModal
            visible
            title="Añadir un comentario"
            description="La nota se guardará firmada junto a las observaciones de la ronda."
            label="COMENTARIO"
            placeholder="Ej.: Puerta de servicio cerrada correctamente"
            confirmLabel="Guardar comentario"
            isSubmitting={busyAction === 'commenting'}
            error={promptError}
            onCancel={closePrompt}
            onSubmit={(text) => {
              void submitPrompt(text);
            }}
          />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  linkText: {
    color: ACCENT,
  },
  offlineBanner: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  banner: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.half,
  },
  dangerText: {
    color: DANGER,
  },
  warningText: {
    color: WARNING,
  },
  successText: {
    color: SUCCESS,
  },
  sectionTitle: {
    marginTop: Spacing.three,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: 160,
  },
  separator: {
    height: Spacing.two,
  },
  emptyList: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  indexBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: Spacing.half,
  },
  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  onAccent: {
    color: '#FFFFFF',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  stateCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actionButton: {
    minHeight: 44,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notes: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  finishedStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  fab: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    bottom: Spacing.four,
    minHeight: 56,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  nfcDock: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    borderWidth: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.half,
  },
  nfcStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  nfcDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  nfcStatusText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  nfcFeedback: {
    textAlign: 'center',
  },
  nfcRetry: {
    alignSelf: 'center',
    marginTop: Spacing.half,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

