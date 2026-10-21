/**
 * Banner de estado de la cola offline.
 *
 * Solo aparece cuando hay marcaciones pendientes o rechazadas. El contador se
 * actualiza en tiempo real porque consume la misma instantánea que usa el
 * sincronizador.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { getErrorMessage } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useOfflineQueue } from '@/hooks/use-offline-queue';
import { useTheme } from '@/hooks/use-theme';

const WARNING = '#B26A00';
const DANGER = '#D93025';
const SUCCESS = '#1E7F4F';

export function OfflineQueueBanner() {
  const theme = useTheme();
  const {
    pendingCount,
    failedCount,
    isOnline,
    isSyncing,
    syncTotal,
    syncCompleted,
    lastError,
    lastFailedError,
    retry,
    discardFailed,
  } = useOfflineQueue();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  if (pendingCount === 0 && failedCount === 0) {
    return null;
  }

  const isBusy = isRetrying || isDiscarding;
  const pendingMessage =
    pendingCount === 1
      ? 'Falta 1 punto por sincronizar. Se sincronizará automáticamente al conectarse a internet.'
      : `Faltan ${pendingCount} puntos por sincronizar. Se sincronizarán automáticamente al conectarse a internet.`;

  let syncStatus: string | null = null;

  if (pendingCount > 0) {
    if (!isOnline) {
      syncStatus =
        'Sin conexión. La marcación quedó guardada y se reenviará al recuperar la señal.';
    } else if (isSyncing) {
      syncStatus = `Sincronizando ${Math.min(syncCompleted + 1, syncTotal)} de ${syncTotal}…`;
    } else if (lastError) {
      syncStatus = `El último intento no terminó: ${lastError}`;
    }
  }

  async function handleRetry() {
    if (isBusy) {
      return;
    }

    setIsRetrying(true);

    try {
      const result = await retry();

      if (result.remaining > 0 && result.synced === 0 && result.failed === 0) {
        Alert.alert(
          'Todavía sin conexión',
          'No se pudo contactar con el servidor. Sus marcaciones siguen guardadas en el dispositivo.',
        );
      }
    } catch (error) {
      Alert.alert('No se pudo reintentar', getErrorMessage(error));
    } finally {
      setIsRetrying(false);
    }
  }

  async function handleDiscard() {
    setIsDiscarding(true);

    try {
      await discardFailed();
    } catch (error) {
      Alert.alert('No se pudieron descartar', getErrorMessage(error));
    } finally {
      setIsDiscarding(false);
    }
  }

  function confirmDiscard() {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Descartar marcaciones con error',
      'Estas marcaciones no se enviarán al servidor y se eliminarán del dispositivo. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: () => {
            void handleDiscard();
          },
        },
      ],
    );
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: pendingCount > 0 ? WARNING : DANGER,
        },
      ]}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.icon,
            { backgroundColor: pendingCount > 0 ? WARNING : DANGER },
          ]}>
          <ThemedText type="smallBold" style={styles.onAccent}>
            {pendingCount > 0 ? '⟳' : '!'}
          </ThemedText>
        </View>

        <View style={styles.headerText}>
          <ThemedText type="smallBold">
            {pendingCount > 0
              ? 'Marcaciones guardadas sin conexión'
              : 'Marcaciones con error de sincronización'}
          </ThemedText>

          {pendingCount > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {pendingMessage}
            </ThemedText>
          ) : null}
        </View>

        {isSyncing || isRetrying ? (
          <ActivityIndicator color={WARNING} />
        ) : (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? SUCCESS : WARNING },
            ]}
          />
        )}
      </View>

      {syncStatus ? (
        <ThemedText type="small" style={styles.statusText}>
          {syncStatus}
        </ThemedText>
      ) : null}

      {failedCount > 0 ? (
        <View style={[styles.failedBox, { borderColor: DANGER }]}>
          <ThemedText type="smallBold" style={styles.failedTitle}>
            {failedCount === 1
              ? '1 marcación no se pudo sincronizar'
              : `${failedCount} marcaciones no se pudieron sincronizar`}
          </ThemedText>
          {lastFailedError ? (
            <ThemedText type="small" themeColor="textSecondary">
              {lastFailedError}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {(pendingCount > 0 || failedCount > 0) && isOnline && !isSyncing ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reintentar la sincronización ahora"
          accessibilityState={{ disabled: isBusy, busy: isRetrying }}
          disabled={isBusy}
          onPress={() => {
            void handleRetry();
          }}
          style={({ pressed }) => [
            styles.retryButton,
            {
              borderColor: WARNING,
              opacity: isBusy ? 0.55 : pressed ? 0.8 : 1,
            },
          ]}>
          <ThemedText type="smallBold" style={styles.warningText}>
            {isRetrying ? 'Reintentando…' : 'Reintentar ahora'}
          </ThemedText>
        </Pressable>
      ) : null}

      {failedCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Descartar marcaciones con error"
          accessibilityState={{ disabled: isBusy, busy: isDiscarding }}
          disabled={isBusy}
          onPress={confirmDiscard}
          style={({ pressed }) => [
            styles.discardButton,
            { opacity: isBusy ? 0.55 : pressed ? 0.8 : 1 },
          ]}>
          <ThemedText type="small" style={styles.dangerText}>
            {isDiscarding ? 'Descartando…' : 'Descartar las marcaciones con error'}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: Spacing.two,
  },
  statusText: {
    color: WARNING,
  },
  failedBox: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.half,
  },
  failedTitle: {
    color: DANGER,
  },
  retryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  discardButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningText: {
    color: WARNING,
  },
  dangerText: {
    color: DANGER,
  },
  onAccent: {
    color: '#FFFFFF',
  },
});
