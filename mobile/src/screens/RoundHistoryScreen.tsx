/**
 * Historial de rondas del guardia.
 *
 * Lista las rondas pausadas, completadas y canceladas. Las pausadas incluyen
 * un botón «Continuar ronda» que reanuda la ronda en el backend y navega a la
 * pantalla activa, donde el cronómetro y los checkpoints previos se restauran.
 */

import { useCallback, useRef, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import { listRoundHistory, resumeRound } from '@/api/rounds';
import type { RoundDetail, RoundStatus } from '@/api/types';
import { OfflineQueueBanner } from '@/components/offline-queue-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime, formatDuration, formatTime } from '@/utils/datetime';

const ACCENT = '#208AEF';
const SUCCESS = '#1E7F4F';
const DANGER = '#D93025';
const WARNING = '#B26A00';

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<RoundStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  PAUSED: 'Pausada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

const STATUS_COLORS: Record<RoundStatus, string> = {
  PENDING: WARNING,
  IN_PROGRESS: ACCENT,
  PAUSED: WARNING,
  COMPLETED: SUCCESS,
  CANCELLED: DANGER,
};

type FilterValue = 'ALL' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
type RangeValue = '24H' | 'ALL';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PAUSED', label: 'Pausadas' },
  { value: 'COMPLETED', label: 'Completadas' },
  { value: 'CANCELLED', label: 'Canceladas' },
];

const RANGES: { value: RangeValue; label: string }[] = [
  { value: '24H', label: 'Últimas 24 h' },
  { value: 'ALL', label: 'Todo' },
];

function HistoryCard({
  round,
  isResuming,
  onContinue,
}: {
  round: RoundDetail;
  isResuming: boolean;
  onContinue: (round: RoundDetail) => void;
}) {
  const theme = useTheme();
  const color = STATUS_COLORS[round.status];
  const isPaused = round.status === 'PAUSED';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: color },
      ]}>
      <View style={styles.cardTop}>
        <View style={[styles.statusChip, { backgroundColor: color }]}>
          <ThemedText type="smallBold" style={styles.onAccent}>
            {STATUS_LABELS[round.status]}
          </ThemedText>
        </View>
        <ThemedText type="code" themeColor="textSecondary">
          Ronda #{round.id}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" numberOfLines={1}>
        {round.company?.name ?? 'Mi ronda'}
      </ThemedText>

      <ThemedText type="code" themeColor="textSecondary">
        {formatDateTime(round.start_time ?? round.created_at)} ·{' '}
        {formatDuration(round.elapsed_seconds)}
      </ThemedText>

      <View style={styles.metaRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {round.logs.length} checkpoints marcados
        </ThemedText>

        {isPaused && round.paused_at ? (
          <ThemedText type="small" style={styles.warningText}>
            En pausa desde {formatTime(round.paused_at)}
          </ThemedText>
        ) : null}
      </View>

      {round.cancel_reason ? (
        <ThemedText type="small" style={styles.dangerText}>
          Motivo: {round.cancel_reason}
        </ThemedText>
      ) : null}

      {isPaused ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Continuar la ronda ${round.id}`}
          accessibilityState={{ disabled: isResuming, busy: isResuming }}
          disabled={isResuming}
          onPress={() => onContinue(round)}
          style={({ pressed }) => [
            styles.continueButton,
            {
              backgroundColor: ACCENT,
              opacity: isResuming ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}>
          {isResuming ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <ThemedText type="smallBold" style={styles.onAccent}>
              Continuar ronda
            </ThemedText>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export default function RoundHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [range, setRange] = useState<RangeValue>('24H');
  const [rounds, setRounds] = useState<RoundDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [resumingId, setResumingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const previousFilterRef = useRef<FilterValue>('ALL');
  const previousRangeRef = useRef<RangeValue>('24H');

  const load = useCallback(
    async (
      mode: 'initial' | 'refresh' | 'more',
      targetPage: number,
      activeFilter: FilterValue,
      activeRange: RangeValue,
    ) => {
      if (mode === 'initial') {
        setIsLoading(true);
      } else if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const response = await listRoundHistory({
          page: targetPage,
          page_size: PAGE_SIZE,
          status: activeFilter === 'ALL' ? undefined : activeFilter,
          // El backend calcula `date_from = now - 24 h` para la ventana por
          // defecto; «Todo» desactiva el filtro temporal.
          last_hours: activeRange === '24H' ? 24 : undefined,
          all_time: activeRange === 'ALL' ? true : undefined,
        });

        setRounds((current) =>
          targetPage === 1 ? response.items : [...current, ...response.items],
        );
        setTotal(response.total);
        setPage(targetPage);
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        hasLoadedRef.current = true;
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const queryChanged =
        previousFilterRef.current !== filter || previousRangeRef.current !== range;
      previousFilterRef.current = filter;
      previousRangeRef.current = range;

      void load(
        queryChanged || !hasLoadedRef.current ? 'initial' : 'refresh',
        1,
        filter,
        range,
      );
    }, [filter, range, load]),
  );

  function goHome() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  }

  function openActiveRound() {
    router.push('/rondas');
  }

  async function handleContinue(round: RoundDetail) {
    if (resumingId !== null) {
      return;
    }

    setResumingId(round.id);

    try {
      await resumeRound(round.id);
      router.push('/rondas');
    } catch (resumeError) {
      Alert.alert(
        'No se pudo continuar la ronda',
        getErrorMessage(resumeError),
      );
    } finally {
      setResumingId(null);
    }
  }


  function renderBody() {
    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={ACCENT} size="large" />
          <ThemedText type="small" themeColor="textSecondary">
            Cargando el historial…
          </ThemedText>
        </View>
      );
    }

    return (
      <FlatList
        data={rounds}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <HistoryCard
            round={item}
            isResuming={resumingId === item.id}
            onContinue={(selected) => {
              void handleContinue(selected);
            }}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void load('refresh', 1, filter, range);
            }}
            tintColor={ACCENT}
            colors={[ACCENT]}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="subtitle">Historial de rondas</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Por defecto se muestran las rondas de las últimas 24 horas.
              Continúe una ronda pausada con su cronómetro y checkpoints ya
              marcados.
            </ThemedText>

            <ThemedText type="code" themeColor="textSecondary">
              PERIODO
            </ThemedText>

            <View style={styles.filters}>
              {RANGES.map((item) => {
                const selected = range === item.value;

                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="button"
                    accessibilityLabel={`Mostrar ${item.label}`}
                    accessibilityState={{ selected }}
                    onPress={() => setRange(item.value)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: selected
                          ? ACCENT
                          : theme.backgroundElement,
                        borderColor: selected
                          ? ACCENT
                          : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={selected ? styles.onAccent : undefined}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <ThemedText type="code" themeColor="textSecondary">
              ESTADO
            </ThemedText>

            <View style={styles.filters}>
              {FILTERS.map((item) => {
                const selected = filter === item.value;

                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="button"
                    accessibilityLabel={`Filtrar por ${item.label}`}
                    accessibilityState={{ selected }}
                    onPress={() => setFilter(item.value)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: selected
                          ? ACCENT
                          : theme.backgroundElement,
                        borderColor: selected
                          ? ACCENT
                          : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      style={selected ? styles.onAccent : undefined}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {error ? (
              <View style={[styles.banner, { borderColor: DANGER }]}>
                <ThemedText type="small" style={styles.dangerText}>
                  {error}
                </ThemedText>
              </View>
            ) : null}
          </View>
        }


        ListEmptyComponent={
          <View style={styles.emptyState}>
            <ThemedText type="smallBold">
              {error
                ? 'No se pudo cargar el historial'
                : range === '24H'
                  ? 'Sin rondas en las últimas 24 horas'
                  : 'Sin rondas todavía'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {error
                ? 'Revise su conexión y vuelva a intentarlo.'
                : range === '24H'
                  ? 'Seleccione «Todo» para consultar rondas anteriores.'
                  : 'Cuando finalice o pause una ronda aparecerá en esta lista.'}
            </ThemedText>

            {error ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reintentar la carga del historial"
                onPress={() => {
                  void load('initial', 1, filter, range);
                }}
                style={({ pressed }) => [
                  styles.retryButton,
                  { borderColor: ACCENT, opacity: pressed ? 0.75 : 1 },
                ]}>
                <ThemedText type="smallBold" style={styles.linkText}>
                  Reintentar
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        }
        ListFooterComponent={
          rounds.length < total ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cargar más rondas"
              accessibilityState={{ disabled: isLoadingMore, busy: isLoadingMore }}
              disabled={isLoadingMore}
              onPress={() => {
                void load('more', page + 1, filter, range);
              }}
              style={({ pressed }) => [
                styles.loadMoreButton,
                {
                  borderColor: theme.backgroundSelected,
                  backgroundColor: theme.backgroundElement,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}>
              {isLoadingMore ? (
                <ActivityIndicator color={ACCENT} size="small" />
              ) : (
                <ThemedText type="smallBold">Cargar más rondas</ThemedText>
              )}
            </Pressable>
          ) : undefined
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
            HISTORIAL
          </ThemedText>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ir a la ronda activa"
            hitSlop={8}
            onPress={openActiveRound}>
            <ThemedText type="smallBold" style={styles.linkText}>
              Mi ronda
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.offlineBanner}>
          <OfflineQueueBanner />
        </View>

        {renderBody()}
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
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  banner: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
  },
  dangerText: {
    color: DANGER,
  },
  warningText: {
    color: WARNING,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
    flexGrow: 1,
  },
  separator: {
    height: Spacing.two,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  retryButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
  },
  loadMoreButton: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  card: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: Spacing.half,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  onAccent: {
    color: '#FFFFFF',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  continueButton: {
    minHeight: 44,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
});

