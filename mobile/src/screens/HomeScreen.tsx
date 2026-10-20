/**
 * Pantalla principal del área autenticada.
 *
 * Muestra la cuenta activa y permite cerrar sesión; al hacerlo, el guard de
 * `AppNavigator` vuelve a la pantalla de login.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import type { UserRole } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  COMPANY_USER: 'Usuario de empresa',
  GUARD: 'Guardia',
};

const DANGER_COLOR = '#D93025';
const ACCENT = '#208AEF';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.infoValue}>
        {value}
      </ThemedText>
    </View>
  );
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const displayName = user?.name ?? 'Guardia';
  const firstName = displayName.split(' ')[0];
  const isGuard = user?.role === 'GUARD';

  async function handleLogout() {
    setIsSigningOut(true);

    try {
      await logout();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="code" themeColor="textSecondary">
              SISTEMA DE RONDAS
            </ThemedText>
            <ThemedText type="subtitle">Hola, {firstName}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Sesión activa. Ya puede registrar sus rondas y checkpoints.
            </ThemedText>
          </View>

          {isGuard ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir mi ronda activa"
                onPress={() => {
                  router.push('/rondas');
                }}
                style={({ pressed }) => [
                  styles.primaryAction,
                  { opacity: pressed ? 0.85 : 1 },
                ]}>
                <View style={styles.primaryActionBody}>
                  <ThemedText type="smallBold" style={styles.primaryActionTitle}>
                    Mi ronda activa
                  </ThemedText>
                  <ThemedText type="small" style={styles.primaryActionSubtitle}>
                    Consulte el cronómetro, pause o reanude la ronda y registre sus
                    checkpoints con QR.
                  </ThemedText>
                </View>
                <ThemedText style={styles.primaryActionArrow}>›</ThemedText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir el historial de rondas"
                onPress={() => {
                  router.push('/historial' as Href);
                }}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  {
                    borderColor: theme.backgroundSelected,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <View style={styles.primaryActionBody}>
                  <ThemedText type="smallBold">Historial de rondas</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Revise sus rondas completadas o canceladas y continúe una ronda
                    pausada donde la dejó.
                  </ThemedText>
                </View>
                <ThemedText style={styles.secondaryActionArrow}>›</ThemedText>
              </Pressable>
            </>
          ) : null}

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Cuenta</ThemedText>
            <InfoRow label="Nombre" value={displayName} />
            <InfoRow label="Correo" value={user?.email ?? 'Sin datos del usuario'} />
            <InfoRow
              label="Rol"
              value={user ? (ROLE_LABELS[user.role] ?? user.role) : 'No disponible'}
            />
            {user?.companies && user.companies.length > 0 && (
              <InfoRow
                label="Empresa"
                value={user.companies.map((company) => company.name).join(', ')}
              />
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Sesión protegida</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              El token JWT se guarda en el dispositivo y se envía automáticamente en cada
              petición a la API.
            </ThemedText>
          </ThemedView>

          <View style={styles.spacer} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
            accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
            disabled={isSigningOut}
            onPress={() => {
              void handleLogout();
            }}
            style={({ pressed }) => [
              styles.logoutButton,
              {
                borderColor: theme.backgroundSelected,
                backgroundColor: theme.backgroundElement,
                opacity: isSigningOut ? 0.6 : pressed ? 0.8 : 1,
              },
            ]}>
            {isSigningOut ? (
              <ActivityIndicator color={DANGER_COLOR} />
            ) : (
              <ThemedText type="smallBold" style={styles.logoutLabel}>
                Cerrar sesión
              </ThemedText>
            )}
          </Pressable>

          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            Sistema de Rondas · Cliente móvil
          </ThemedText>
        </ScrollView>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    backgroundColor: ACCENT,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  primaryActionBody: {
    flex: 1,
    gap: Spacing.half,
  },
  primaryActionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  primaryActionSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  primaryActionArrow: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 32,
  },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  secondaryActionArrow: {
    color: ACCENT,
    fontSize: 28,
    lineHeight: 32,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  infoValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  spacer: {
    flex: 1,
    minHeight: Spacing.five,
  },
  logoutButton: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  logoutLabel: {
    color: DANGER_COLOR,
  },
  footer: {
    textAlign: 'center',
  },
});
