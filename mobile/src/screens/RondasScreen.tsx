/**
 * Pantalla operativa del guardia: checkpoints de la ronda activa.
 *
 * Se recarga al volver del escáner (`useFocusEffect`) para reflejar los puntos
 * recién visitados sin reiniciar la aplicación.
 */

import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import {
  getActiveRound,
  listRoundCheckpoints,
  listRounds,
  startRound,
} from '@/api/rounds';
import type {
  Round,
  RoundCheckpoint,
  RoundDetail,
  RoundStatus,
} from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#208AEF';
const SUCCESS = '#1E7F4F';
const DANGER = '#D93025';

const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  PAUSED: 'Pausada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

/** Formatea la hora de marcación como HH:MM (independiente del locale). */
function formatTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function CheckpointRow({
  checkpoint,
  index,
}: {
  checkpoint: RoundCheckpoint;
  index: number;
}) {
  const theme = useTheme();
  const visited = checkpoint.is_visited;

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
          {visited ? 'Visitado' : 'Pendiente'}
        </ThemedText>
      </View>
    </View>
  );
}

export default function RondasScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [round, setRound] = useState<RoundDetail | null>(null);
  const [pendingRound, setPendingRound] = useState<Round | null>(null);
  const [checkpoints, setCheckpoints] = useState<RoundCheckpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const active = await getActiveRound();

      if (!active) {
        // Sin ronda en curso: se busca una pendiente para poder iniciarla.
        const pending = await listRounds({ status: 'PENDING', page_size: 1 });
        setPendingRound(pending.items[0] ?? null);
        setRound(null);
        setCheckpoints([]);
        return;
      }

      const items = await listRoundCheckpoints(active.id);
      setPendingRound(null);
      setRound(active);
      setCheckpoints(items);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      hasLoadedRef.current = true;
    }
  }, []);

  // Al volver del escáner se recarga en silencio para actualizar los estados.
  useFocusEffect(
    useCallback(() => {
      void load(hasLoadedRef.current ? 'refresh' : 'initial');
    }, [load]),
  );

  const total = checkpoints.length;
  const visited = checkpoints.filter((checkpoint) => checkpoint.is_visited).length;
  const allVisited = total > 0 && visited === total;
  const canScan = total > 0 && !allVisited;
  const progressPercent = total > 0 ? Math.round((visited / total) * 100) : 0;

  function openScanner() {
    if (!round) {
      return;
    }

    router.push({
      pathname: '/scan',
      params: { roundId: String(round.id) },
    });
  }

  function goHome() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  }

  async function handleStartRound() {
    if (!pendingRound || isStarting) {
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      await startRound(pendingRound.id);
      await load('initial');
    } catch (startError) {
      setError(getErrorMessage(startError));
    } finally {
      setIsStarting(false);
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

    if (!round && pendingRound) {
      return (
        <View style={styles.centered}>
          <ThemedView type="backgroundElement" style={styles.stateCard}>
            <ThemedText type="smallBold">Ronda pendiente de inicio</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tiene una ronda asignada todavía no iniciada. Iníciela para ver sus
              checkpoints y comenzar a escanear.
            </ThemedText>

            {error ? (
              <ThemedText type="small" style={styles.dangerText}>
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Iniciar la ronda asignada"
              accessibilityState={{ disabled: isStarting, busy: isStarting }}
              disabled={isStarting}
              onPress={() => {
                void handleStartRound();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: isStarting ? 0.7 : pressed ? 0.85 : 1 },
              ]}>
              {isStarting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText type="smallBold" style={styles.onAccent}>
                  Iniciar ronda
                </ThemedText>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Actualizar ronda activa"
              onPress={() => {
                void load('refresh');
              }}
              style={styles.secondaryButton}>
              <ThemedText type="smallBold">Actualizar</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      );
    }

    if (error && !round) {
      return (
        <View style={styles.centered}>
          <ThemedView type="backgroundElement" style={styles.stateCard}>
            <ThemedText type="smallBold">No se pudo cargar la ronda</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {error}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reintentar la carga de la ronda"
              onPress={() => {
                void load('initial');
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Reintentar
              </ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      );
    }

    if (!round) {
      return (
        <View style={styles.centered}>
          <ThemedView type="backgroundElement" style={styles.stateCard}>
            <ThemedText type="smallBold">Sin ronda activa</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              No tiene una ronda asignada en este momento. Contacte a su supervisor
              para que la cree y vuelva a actualizar.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Actualizar ronda activa"
              onPress={() => {
                void load('initial');
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.onAccent}>
                Actualizar
              </ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      );
    }

    return (
      <FlatList
        data={checkpoints}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => <CheckpointRow checkpoint={item} index={index} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
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
              <View style={styles.statusChip}>
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

            <View
              style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
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

            {allVisited ? (
              <View style={[styles.banner, { borderColor: SUCCESS }]}>
                <ThemedText type="small" style={styles.successText}>
                  Todos los puntos de esta ronda están visitados.
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
        </View>

        {renderBody()}

        {round && !isLoading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Escanear checkpoint QR"
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
    backgroundColor: ACCENT,
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
  },
  dangerText: {
    color: DANGER,
  },
  successText: {
    color: SUCCESS,
  },
  sectionTitle: {
    marginTop: Spacing.three,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: 140,
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
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: Spacing.three,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
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
  fab: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    bottom: Spacing.four,
    minHeight: 56,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});


