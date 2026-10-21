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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import {
  addRoundComment,
  cancelRound,
  getActiveRound,
  getRound,
  listRoundCheckpoints,
  pauseRound,
  resumeRound,
  startNewRound,
} from '@/api/rounds';
import type {
  RoundCheckpoint,
  RoundDetail,
  RoundStatus,
} from '@/api/types';
import { CommentPromptModal } from '@/components/comment-prompt-modal';
import { InactivityWarning, RoundTimer } from '@/components/round-timer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const { roundId: rawFinishedRoundId } = useLocalSearchParams<{
    roundId?: string | string[];
  }>();

  const finishedRoundIdParam = Number(
    Array.isArray(rawFinishedRoundId) ? rawFinishedRoundId[0] : rawFinishedRoundId,
  );

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
      void load(hasLoadedRef.current ? 'refresh' : 'initial');
    }, [load]),
  );

  // El cronómetro avanza cada segundo solo mientras la ronda está en curso.
  useEffect(() => {
    if (!round || round.status !== 'IN_PROGRESS') {
      return;
    }

    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [round]);

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
    if (!round || !canScan) {
      return;
    }

    router.push({
      pathname: '/scan',
      params: { roundId: String(round.id) },
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
      const created = await startNewRound();

      // La ronda ya está en curso: se pinta de inmediato para que el
      // cronómetro arranque aunque la consulta de checkpoints tarde.
      setFinishedRound(null);
      setRound(created);
      syncTimer(created);
      lastRoundIdRef.current = created.id;

      try {
        const items = await listRoundCheckpoints(created.id);
        setCheckpoints(items);
      } catch {
        setCheckpoints([]);
      }

      router.push({
        pathname: '/scan',
        params: { roundId: String(created.id), from: 'rounds' },
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

            <ActionButton
              label="Iniciar Nueva Ronda"
              variant="primary"
              onPress={() => {
                void handleStartNewRound();
              }}
              loading={busyAction === 'starting'}
              disabled={busyAction !== 'none'}
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
            Inicie una ronda nueva para comenzar el recorrido. El servidor
            asignará automáticamente los checkpoints activos de su empresa.
          </ThemedText>

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
            disabled={busyAction !== 'none'}
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

        {renderBody()}

        {round && isInProgress ? (
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
});

