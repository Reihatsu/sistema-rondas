/**
 * Pantalla principal del área autenticada.
 *
 * Muestra la cuenta activa y permite cerrar sesión; al hacerlo, el guard de
 * `AppNavigator` vuelve a la pantalla de login.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

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
  const [hasActiveRound, setHasActiveRound] = useState(false);
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

  // Con una ronda abierta la empresa queda fijada por esa ronda: se bloquea el
  // selector para evitar elegir una empresa que no corresponde.
  useFocusEffect(
    useCallback(() => {
      let isCurrent = true;

      if (!isGuard) {
        setHasActiveRound(false);
        return () => {
          isCurrent = false;
        };
      }

      getActiveRound()
        .then((active) => {
          if (!isCurrent) {
            return;
          }

          const isOpen = Boolean(active && active.status !== 'CANCELLED');
          setHasActiveRound(isOpen);

          // El selector bloqueado debe mostrar la empresa real de la ronda,
          // aunque la app se haya reiniciado y la primera empresa asignada sea
          // otra distinta.
          if (isOpen && active) {
            setSelectedCompanyId((current) =>
              companies.some((company) => company.id === active.company_id)
                ? active.company_id
                : current,
            );
          }
        })
        .catch(() => {
          // Sin conexión se conserva el último estado conocido; iniciar una
          // ronda sigue validando el conflicto contra el backend.
        });

      return () => {
        isCurrent = false;
      };
    }, [companies, isGuard]),
  );

  /**
   * Crea una ronda nueva desde el servidor y abre el flujo que corresponde.
   *
   * Las empresas QR abren el escáner; las empresas NFC van directamente a la
   * pantalla de la ronda, donde el lector pasivo se activa solo. Antes de crear
   * se consulta la ronda activa: si existe, se evita el `409` del backend y se
   * ofrece continuarla para no dejar una ronda huérfana.
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
      const createdPointType =
        created.company?.point_type ??
        companies.find((company) => company.id === created.company_id)?.point_type ??
        'QR';

      // NFC se lee de forma pasiva en la pantalla de la ronda: no se abre una
      // pantalla intermedia ni se muestra un botón para leer la etiqueta.
      if (createdPointType === 'NFC') {
        router.push('/rondas');
        return;
      }

      router.push({
        pathname: '/scan',
        params: {
          roundId: String(created.id),
          from: 'home',
          pointType: 'QR',
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
                  disabled={isStartingRound || hasActiveRound}
                  title={
                    hasActiveRound
                      ? 'Empresa fijada por la ronda activa'
                      : 'Empresa de la ronda'
                  }
                />
              ) : null}

              {hasActiveRound ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Tiene una ronda en curso: la empresa queda fijada por esa ronda.
                  Continúela desde «Mis Rondas» antes de iniciar otra.
                </ThemedText>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  hasActiveRound
                    ? 'Ya tiene una ronda activa: continúela desde Mis Rondas'
                    : companies.length === 0
                      ? 'No puede iniciar una ronda sin empresas activas'
                      : 'Iniciar una nueva ronda'
                }
                accessibilityState={{
                  disabled:
                    isStartingRound || companies.length === 0 || hasActiveRound,
                  busy: isStartingRound,
                }}
                disabled={
                  isStartingRound || companies.length === 0 || hasActiveRound
                }
                onPress={() => {
                  void handleStartNewRound();
                }}
                style={({ pressed }) => [
                  styles.primaryAction,
                  {
                    opacity:
                      isStartingRound ||
                      companies.length === 0 ||
                      hasActiveRound
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
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir puntos de control"
              onPress={() => {
                router.push('/puntos' as Href);
              }}
              style={({ pressed }) => [
                styles.secondaryAction,
                {
                  borderColor: theme.backgroundSelected,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <View style={styles.primaryActionBody}>
                <ThemedText type="smallBold">Puntos de control</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Consulte la ubicación y el UID NFC de los puntos de sus
                  empresas para mantenerlos actualizados.
                </ThemedText>
              </View>
              <ThemedText style={styles.secondaryActionArrow}>›</ThemedText>
            </Pressable>
          )}

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
