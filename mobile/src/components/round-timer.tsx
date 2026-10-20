/**
 * Cronómetro general de la ronda.
 *
 * El valor mostrado lo calcula la pantalla combinando el tiempo del backend
 * (`elapsed_seconds`) con el tiempo transcurrido desde la última sincronización,
 * de modo que el reloj avance cada segundo sin llamar a la API.
 */

import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { formatClock } from '@/utils/datetime';

const ACCENT = '#208AEF';
const WARNING = '#B26A00';
const DANGER = '#D93025';
const MUTED = '#60646C';

export function RoundTimer({
  elapsedSeconds,
  isPaused,
  caption,
}: {
  elapsedSeconds: number;
  isPaused: boolean;
  caption: string;
}) {
  return (
    <View style={styles.container}>
      <ThemedText type="code" themeColor="textSecondary">
        CRONÓMETRO DE LA RONDA
      </ThemedText>

      <ThemedText
        accessibilityLabel={`Tiempo de ronda ${formatClock(elapsedSeconds)}`}
        style={[styles.clock, { color: isPaused ? MUTED : ACCENT }]}>
        {formatClock(elapsedSeconds)}
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary">
        {caption}
      </ThemedText>
    </View>
  );
}

/** Banner de aviso cuando se acerca la cancelación por inactividad. */
export function InactivityWarning({
  remainingSeconds,
  timeoutMinutes,
}: {
  remainingSeconds: number;
  timeoutMinutes: number;
}) {
  const urgent = remainingSeconds <= 120;
  const color = urgent ? DANGER : WARNING;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const remainingText = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <View style={[styles.warning, { borderColor: color }]}>
      <ThemedText type="smallBold" style={{ color }}>
        {urgent ? 'Ronda a punto de cancelarse' : 'Aviso de inactividad'}
      </ThemedText>
      <ThemedText type="small" style={{ color }}>
        Marque un checkpoint en los próximos {remainingText} minutos o la ronda
        se cancelará automáticamente ({timeoutMinutes} min sin actividad).
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.two,
  },
  clock: {
    fontFamily: Fonts.mono,
    fontSize: 46,
    lineHeight: 54,
    fontWeight: '700',
    letterSpacing: 1,
  },
  warning: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.half,
  },
});
