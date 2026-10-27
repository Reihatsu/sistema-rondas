/**
 * Pantalla principal del área autenticada.
 *
 * Muestra la cuenta activa y permite cerrar sesión; al hacerlo, el guard de
 * `AppNavigator` vuelve a la pantalla de login.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import { getActiveRound, startNewRound } from '@/api/rounds';
import type { UserRole } from '@/api/types';
import { CompanyPicker } from '@/components/company-picker';
import { OfflineQueueBanner } from '@/components/offline-queue-banner';
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
  const [isStartingRound, setIsStartingRound] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

  const displayName = user?.name ?? 'Guardia';
  const firstName = displayName.split(' ')[0];
  const isGuard = user?.role === 'GUARD';

  /** Empresas activas asignadas al usuario; una ronda usa solo una. */
  const companies = useMemo(
    () => (user?.companies ?? []).filter((company) => company.is_active),
    [user],
  );

  // La selección debe apuntar siempre a una empresa vigente del usuario.
  useEffect(() => {
    setSelectedCompanyId((current) => {
      if (current !== null && companies.some((company) => company.id === current)) {
        return current;
      }

      return companies[0]?.id ?? null;
    });
  }, [companies]);

  /**
   * Crea una ronda nueva desde el servidor y abre directamente el escáner.
   *
   * Antes de crear se consulta la ronda activa: si existe, se evita el `409`
   * del backend y se ofrece continuarla para no dejar una ronda huérfana.
   */
  async function handleStartNewRound() {
    if (!isGuard || isStartingRound || companies.length === 0) {
      return;
    }

    setIsStartingRound(true);

    try {
      const active = await getActiveRound();

      if (active && active.status !== 'CANCELLED') {
        const isPaused = active.status === 'PAUSED';

        Alert.alert(
          isPaused ? 'Tiene una ronda pausada' : 'Ya tiene una ronda en curso',
          isPaused
            ? 'Reanude su ronda pausada para continuar el cronómetro y los checkpoints ya marcados.'
            : 'Continue la ronda actual antes de iniciar una nueva.',
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Ver mi ronda',
              onPress: () => {
                router.push('/rondas');
              },
            },
          ],
        );
        return;
      }

      const created = await startNewRound(selectedCompanyId ?? undefined);

      router.push({
        pathname: '/scan',
        params: {
          roundId: String(created.id),
          from: 'home',
          pointType: created.company?.point_type ?? 'QR',
        },
      });
    } catch (startError) {
      const message = getErrorMessage(startError);

      // Carrera entre dos dispositivos: el backend rechaza la segunda ronda
      // con 409 y se ofrece abrir la que ya está abierta.
      if (/ya tiene una ronda/i.test(message)) {
        Alert.alert('Ronda en curso', message, [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Ver mi ronda',
            onPress: () => {
              router.push('/rondas');
            },
          },
        ]);
      } else {
        Alert.alert('No se pudo iniciar la ronda', message);
      }
    } finally {
      setIsStartingRound(false);
    }
  }

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

          <OfflineQueueBanner />

          {isGuard ? (
            <>
              {companies.length > 1 ? (
                <CompanyPicker
                  companies={companies}
                  selectedCompanyId={selectedCompanyId}
                  onSelect={setSelectedCompanyId}
                  disabled={isStartingRound}
                  title="Empresa de la ronda"
                />
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  companies.length === 0
                    ? 'No puede iniciar una ronda sin empresas activas'
                    : 'Iniciar una nueva ronda'
                }
                accessibilityState={{
                  disabled: isStartingRound || companies.length === 0,
                  busy: isStartingRound,
                }}
                disabled={isStartingRound || companies.length === 0}
                onPress={() => {
                  void handleStartNewRound();
                }}
                style={({ pressed }) => [
                  styles.primaryAction,
                  {
                    opacity:
                      isStartingRound || companies.length === 0
                        ? 0.7
                        : pressed
                          ? 0.85
                          : 1,
                  },
                ]}>
                <View style={styles.primaryActionBody}>
                  <ThemedText type="smallBold" style={styles.primaryActionTitle}>
                    Iniciar Nueva Ronda
                  </ThemedText>
                  <ThemedText type="small" style={styles.primaryActionSubtitle}>
                    Cree una ronda y comience a escanear los checkpoints activos
                    de la empresa seleccionada.
                  </ThemedText>
                </View>
                {isStartingRound ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.primaryActionArrow}>›</ThemedText>
                )}
              </Pressable>

              {companies.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No tiene empresas activas asignadas. Solicite al administrador que
                  le asigne una empresa con puntos de control para poder iniciar rondas.
                </ThemedText>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir mi ronda activa"
                onPress={() => {
                  router.push('/rondas');
                }}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  {
                    borderColor: theme.backgroundSelected,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <View style={styles.primaryActionBody}>
                  <ThemedText type="smallBold">Mi ronda activa</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Consulte el cronómetro, pause o reanude la ronda y registre
                    sus checkpoints con QR o NFC.
                  </ThemedText>
                </View>
                <ThemedText style={styles.secondaryActionArrow}>›</ThemedText>
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
