/**
 * Configuración móvil de Puntos de Control para supervisión.
 *
 * Replica en la app las acciones del panel web para el alcance del usuario:
 *
 * - Los supervisores (y administradores) pueden listar, crear y editar los
 *   puntos de sus empresas asignadas.
 * - Los usuarios de empresa pueden consultarlos en modo solo lectura.
 * - Los puntos QR permiten capturar la ubicación GPS actual del dispositivo;
 *   los puntos NFC editan el UID físico de la etiqueta. Ambos campos son
 *   opcionales y pueden completarse después.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

import { getErrorMessage } from '@/api/client';
import {
  createCheckpoint,
  listCheckpoints,
  updateCheckpoint,
  type CheckpointWritePayload,
} from '@/api/checkpoints';
import type { Checkpoint, CompanySummary, PointType } from '@/api/types';
import { CompanyPicker } from '@/components/company-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentCoordinates } from '@/services/location';

const ACCENT = '#208AEF';
const PURPLE = '#6B4EFF';
const DANGER = '#D93025';
const WARNING = '#B45309';
const SUCCESS = '#15803D';

const PAGE_SIZE = 50;
const DEFAULT_GEOFENCE_METERS = 50;

type ActiveFilter = 'all' | 'active' | 'inactive';

interface CheckpointFormState {
  name: string;
  code: string;
  uid_nfc: string;
  location_description: string;
  latitude: string;
  longitude: string;
  geofence_radius_m: string;
  is_active: boolean;
}

const EMPTY_FORM: CheckpointFormState = {
  name: '',
  code: '',
  uid_nfc: '',
  location_description: '',
  latitude: '',
  longitude: '',
  geofence_radius_m: String(DEFAULT_GEOFENCE_METERS),
  is_active: true,
};

/** Canoniza el UID igual que el backend: mayúsculas y sin separadores. */
function normalizeNfcUid(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Convierte un campo de texto a número o `null` si está vacío. */
function toNumberOrNull(value: string): number | null {
  const text = value.trim().replace(',', '.');
  if (text === '') {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointTypeOf(checkpoint: Checkpoint): PointType {
  return (
    checkpoint.company?.point_type ??
    checkpoint.point_type ??
    (checkpoint.uid_nfc ? 'NFC' : 'QR')
  );
}

function formatCoordinates(checkpoint: Checkpoint): string | null {
  if (checkpoint.latitude === null || checkpoint.longitude === null) {
    return null;
  }
  return `${checkpoint.latitude.toFixed(6)}, ${checkpoint.longitude.toFixed(6)}`;
}

export default function CheckpointsScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  const role = user?.role;
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const canView = canManage || role === 'COMPANY_USER';

  const companies = useMemo(
    () => (user?.companies ?? []).filter((company) => company.is_active),
    [user],
  );

  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(
    () => companies[0]?.id ?? null,
  );
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Checkpoint | null>(null);
  const [form, setForm] = useState<CheckpointFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturingGps, setIsCapturingGps] = useState(false);

  const requestIdRef = useRef(0);
  const queryKeyRef = useRef<string | null>(null);

  const selectedCompany: CompanySummary | null =
    companies.find((company) => company.id === selectedCompanyId) ?? null;
  const selectedPointType: PointType = selectedCompany?.point_type ?? 'QR';
  const isNfcCompany = selectedPointType === 'NFC';

  // La empresa elegida debe seguir existiendo tras una recarga de la sesión.
  useEffect(() => {
    setSelectedCompanyId((current) => {
      if (current !== null && companies.some((company) => company.id === current)) {
        return current;
      }
      return companies[0]?.id ?? null;
    });
  }, [companies]);

  const load = useCallback(
    async (
      mode: 'initial' | 'refresh' | 'more',
      targetPage: number,
      companyId: number | null,
      filter: ActiveFilter,
    ) => {
      if (companyId === null) {
        setItems([]);
        setTotal(0);
        setPage(1);
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (mode === 'initial') {
        setIsLoading(true);
      } else if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const response = await listCheckpoints({
          page: targetPage,
          page_size: PAGE_SIZE,
          company_id: companyId,
          is_active: filter === 'all' ? undefined : filter === 'active',
        });

        if (requestId !== requestIdRef.current) {
          return;
        }

        setItems((current) =>
          targetPage === 1 ? response.items : [...current, ...response.items],
        );
        setTotal(response.total);
        setPage(targetPage);
      } catch (loadError) {
        if (requestId === requestIdRef.current) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    },
    [],
  );

  // Recarga al entrar a la pantalla y cada vez que cambia empresa o filtro.
  useFocusEffect(
    useCallback(() => {
      const queryKey = `${selectedCompanyId ?? 'none'}:${activeFilter}`;
      const queryChanged = queryKeyRef.current !== queryKey;
      queryKeyRef.current = queryKey;

      void load(
        queryChanged ? 'initial' : 'refresh',
        1,
        selectedCompanyId,
        activeFilter,
      );
    }, [activeFilter, load, selectedCompanyId]),
  );

  function setField<K extends keyof CheckpointFormState>(
    key: K,
    value: CheckpointFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    if (!canManage || selectedCompanyId === null) {
      return;
    }
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setFormNotice(null);
    setIsFormOpen(true);
  }

  function openEdit(checkpoint: Checkpoint) {
    if (!canManage) {
      return;
    }
    setEditing(checkpoint);
    setForm({
      name: checkpoint.name,
      code: checkpoint.code,
      uid_nfc: checkpoint.uid_nfc ?? '',
      location_description: checkpoint.location_description ?? '',
      latitude:
        checkpoint.latitude === null ? '' : String(checkpoint.latitude),
      longitude:
        checkpoint.longitude === null ? '' : String(checkpoint.longitude),
      geofence_radius_m: String(
        checkpoint.geofence_radius_m ?? DEFAULT_GEOFENCE_METERS,
      ),
      is_active: checkpoint.is_active,
    });
    setFormError(null);
    setFormNotice(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    if (isSaving || isCapturingGps) {
      return;
    }
    setIsFormOpen(false);
    setEditing(null);
    setFormError(null);
    setFormNotice(null);
  }

  async function handleCaptureGps() {
    if (isCapturingGps) {
      return;
    }

    setIsCapturingGps(true);
    setFormError(null);
    setFormNotice(null);

    try {
      const coordinates = await getCurrentCoordinates();
      setForm((current) => ({
        ...current,
        latitude: coordinates.latitude.toFixed(6),
        longitude: coordinates.longitude.toFixed(6),
      }));
      setFormNotice(
        coordinates.accuracy === null
          ? 'Ubicación GPS capturada. Revise las coordenadas antes de guardar.'
          : `Ubicación GPS capturada (precisión ±${Math.round(
              coordinates.accuracy,
            )} m). Revise las coordenadas antes de guardar.`,
      );
    } catch (locationError) {
      setFormError(getErrorMessage(locationError));
    } finally {
      setIsCapturingGps(false);
    }
  }

  async function handleSubmit() {
    if (isSaving || selectedCompanyId === null) {
      return;
    }

    setFormNotice(null);

    const name = form.name.trim();
    if (name.length < 2) {
      setFormError('El nombre debe tener al menos 2 caracteres.');
      return;
    }

    const latitude = toNumberOrNull(form.latitude);
    const longitude = toNumberOrNull(form.longitude);

    if ((latitude === null) !== (longitude === null)) {
      setFormError('Indique latitud y longitud juntas, o deje ambas vacías.');
      return;
    }
    if (latitude !== null && (latitude < -90 || latitude > 90)) {
      setFormError('La latitud debe estar entre -90 y 90.');
      return;
    }
    if (longitude !== null && (longitude < -180 || longitude > 180)) {
      setFormError('La longitud debe estar entre -180 y 180.');
      return;
    }

    const radius = toNumberOrNull(form.geofence_radius_m);
    if (radius === null || radius < 10 || radius > 1000) {
      setFormError('El radio de geovalla debe estar entre 10 y 1000 metros.');
      return;
    }

    const uidNfc = normalizeNfcUid(form.uid_nfc);
    const payload: CheckpointWritePayload = {
      name,
      location_description: form.location_description.trim() || null,
      latitude: isNfcCompany ? null : latitude,
      longitude: isNfcCompany ? null : longitude,
      geofence_radius_m: Math.round(radius),
      uid_nfc: isNfcCompany ? uidNfc || null : null,
      is_active: form.is_active,
    };

    // El código vacío conserva el actual al editar; al crear, el servidor
    // genera el siguiente disponible.
    const code = form.code.trim().toUpperCase();
    if (code) {
      payload.code = code;
    } else if (!editing) {
      payload.code = null;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      if (editing) {
        await updateCheckpoint(editing.id, payload);
        setNotice('Punto de control actualizado correctamente.');
      } else {
        await createCheckpoint({ ...payload, company_id: selectedCompanyId });
        setNotice('Punto de control creado correctamente.');
      }

      setIsFormOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      await load('refresh', 1, selectedCompanyId, activeFilter);
    } catch (saveError) {
      setFormError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  function confirmToggle(checkpoint: Checkpoint) {
    const willDeactivate = checkpoint.is_active;

    Alert.alert(
      willDeactivate ? 'Desactivar punto de control' : 'Reactivar punto de control',
      willDeactivate
        ? `El punto "${checkpoint.name}" se conservará en el histórico, pero no se incluirá en rondas nuevas.`
        : `El punto "${checkpoint.name}" volverá a estar disponible para las rondas de su empresa.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: willDeactivate ? 'Sí, desactivar' : 'Sí, reactivar',
          style: willDeactivate ? 'destructive' : 'default',
          onPress: () => {
            void toggleActive(checkpoint);
          },
        },
      ],
    );
  }

  async function toggleActive(checkpoint: Checkpoint) {
    if (togglingId !== null) {
      return;
    }

    setTogglingId(checkpoint.id);
    setError(null);

    try {
      await updateCheckpoint(checkpoint.id, {
        is_active: !checkpoint.is_active,
      });
      setNotice(
        checkpoint.is_active
          ? 'Punto de control desactivado. Se conserva para el histórico.'
          : 'Punto de control reactivado correctamente.',
      );
      await load('refresh', 1, selectedCompanyId, activeFilter);
    } catch (toggleError) {
      setError(getErrorMessage(toggleError));
    } finally {
      setTogglingId(null);
    }
  }

  function goHome() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/' as Href);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.screenHeader}>
          <View style={styles.titleRow}>
            <View style={styles.titleBody}>
              <ThemedText type="code" themeColor="textSecondary">
                SUPERVISIÓN
              </ThemedText>
              <ThemedText type="subtitle">Puntos de control</ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver al inicio"
              onPress={goHome}
              style={({ pressed }) => [
                styles.backButton,
                {
                  borderColor: theme.backgroundSelected,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}>
              <ThemedText type="smallBold">Volver</ThemedText>
            </Pressable>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {canManage
              ? 'Consulte y actualice los puntos de sus empresas. Los cambios se aplican a las próximas rondas.'
              : 'Consulte los puntos configurados para sus empresas asignadas.'}
          </ThemedText>
        </View>

        {!canView ? (
          <ScrollView contentContainerStyle={styles.stateContent}>
            <ThemedText type="smallBold">Acceso restringido</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Esta sección está disponible para supervisores y usuarios de
              empresa. Los guardias registran sus checkpoints desde la ronda
              activa.
            </ThemedText>
          </ScrollView>
        ) : companies.length === 0 ? (
          <ScrollView contentContainerStyle={styles.stateContent}>
            <ThemedText type="smallBold">Sin empresas asignadas</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Solicite al administrador que asigne al menos una empresa activa a
              su usuario para poder consultar sus puntos de control.
            </ThemedText>
          </ScrollView>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => {
                  void load('refresh', 1, selectedCompanyId, activeFilter);
                }}
                tintColor={ACCENT}
                colors={[ACCENT]}
              />
            }
            ListHeaderComponent={
              <View style={styles.listHeader}>
                {error ? (
                  <View style={[styles.banner, { borderColor: DANGER }]}>
                    <View style={styles.bannerBody}>
                      <ThemedText type="smallBold" style={{ color: DANGER }}>
                        No se pudieron cargar los puntos
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {error}
                      </ThemedText>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Reintentar carga de puntos"
                      onPress={() => {
                        void load(
                          'refresh',
                          1,
                          selectedCompanyId,
                          activeFilter,
                        );
                      }}
                      style={({ pressed }) => [
                        styles.bannerAction,
                        {
                          borderColor: DANGER,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}>
                      <ThemedText type="small" style={{ color: DANGER }}>
                        Reintentar
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : null}

                {notice ? (
                  <View style={[styles.banner, { borderColor: SUCCESS }]}>
                    <ThemedText
                      type="small"
                      style={{ color: SUCCESS, flex: 1 }}>
                      {notice}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cerrar aviso"
                      onPress={() => setNotice(null)}
                      style={({ pressed }) => [
                        styles.bannerAction,
                        {
                          borderColor: SUCCESS,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}>
                      <ThemedText type="small" style={{ color: SUCCESS }}>
                        Cerrar
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : null}

                {companies.length > 1 ? (
                  <CompanyPicker
                    companies={companies}
                    selectedCompanyId={selectedCompanyId}
                    onSelect={setSelectedCompanyId}
                    title="Empresa"
                  />
                ) : selectedCompany ? (
                  <ThemedView
                    type="backgroundElement"
                    style={styles.singleCompany}>
                    <View style={styles.singleCompanyBody}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Empresa
                      </ThemedText>
                      <ThemedText type="smallBold">
                        {selectedCompany.name}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        pointBadgeStyle(selectedPointType),
                      ]}>
                      <ThemedText type="small" style={styles.badgeTextDark}>
                        {selectedPointType}
                      </ThemedText>
                    </View>
                  </ThemedView>
                ) : null}

                <View style={styles.filterRow}>
                  {(
                    [
                      ['all', 'Todos'],
                      ['active', 'Activos'],
                      ['inactive', 'Inactivos'],
                    ] as const
                  ).map(([value, label]) => {
                    const selected = activeFilter === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setActiveFilter(value)}
                        style={({ pressed }) => [
                          styles.filterChip,
                          {
                            borderColor: selected
                              ? ACCENT
                              : theme.backgroundSelected,
                            backgroundColor: selected
                              ? ACCENT
                              : theme.backgroundElement,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}>
                        <ThemedText
                          type="small"
                          style={
                            selected ? styles.filterChipTextSelected : undefined
                          }>
                          {label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.countRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {isLoading
                      ? 'Cargando puntos…'
                      : `${total} ${
                          total === 1 ? 'punto registrado' : 'puntos registrados'
                        }`}
                  </ThemedText>
                  {canManage ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Crear punto de control"
                      onPress={openCreate}
                      style={({ pressed }) => [
                        styles.newButton,
                        { opacity: pressed ? 0.85 : 1 },
                      ]}>
                      <ThemedText type="smallBold" style={styles.newButtonText}>
                        + Nuevo punto
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            }

            ListEmptyComponent={
              <View style={styles.emptyState}>
                {isLoading ? (
                  <ActivityIndicator color={ACCENT} />
                ) : (
                  <>
                    <ThemedText type="smallBold">
                      No hay puntos de control
                    </ThemedText>
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.emptyText}>
                      {activeFilter === 'all'
                        ? 'Esta empresa todavía no tiene puntos configurados.'
                        : 'No hay puntos con el estado seleccionado.'}
                    </ThemedText>
                    {canManage && activeFilter === 'all' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Crear el primer punto de control"
                        onPress={openCreate}
                        style={({ pressed }) => [
                          styles.newButton,
                          { opacity: pressed ? 0.85 : 1 },
                        ]}>
                        <ThemedText
                          type="smallBold"
                          style={styles.newButtonText}>
                          Crear el primer punto
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <CheckpointCard
                checkpoint={item}
                canManage={canManage}
                isToggling={togglingId === item.id}
                onEdit={() => openEdit(item)}
                onToggle={() => confirmToggle(item)}
              />
            )}
            ListFooterComponent={
              items.length < total ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cargar más puntos"
                  disabled={isLoadingMore}
                  onPress={() => {
                    void load(
                      'more',
                      page + 1,
                      selectedCompanyId,
                      activeFilter,
                    );
                  }}
                  style={({ pressed }) => [
                    styles.loadMoreButton,
                    {
                      borderColor: theme.backgroundSelected,
                      opacity: isLoadingMore ? 0.6 : pressed ? 0.8 : 1,
                    },
                  ]}>
                  {isLoadingMore ? (
                    <ActivityIndicator color={ACCENT} />
                  ) : (
                    <ThemedText type="smallBold">
                      Cargar más ({items.length} de {total})
                    </ThemedText>
                  )}
                </Pressable>
              ) : undefined
            }
          />
        )}

        <Modal
          visible={isFormOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={closeForm}>
          <ThemedView style={styles.modalContainer}>
            <SafeAreaView style={styles.modalSafeArea} edges={['top', 'bottom']}>
              <View style={styles.modalHeader}>
                <View style={styles.titleBody}>
                  <ThemedText type="code" themeColor="textSecondary">
                    {selectedPointType} · {selectedCompany?.name ?? 'EMPRESA'}
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {editing ? 'Editar punto' : 'Nuevo punto'}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar formulario"
                  disabled={isSaving || isCapturingGps}
                  onPress={closeForm}
                  style={({ pressed }) => [
                    styles.closeButton,
                    {
                      borderColor: theme.backgroundSelected,
                      opacity:
                        isSaving || isCapturingGps ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}>
                  <ThemedText type="smallBold">Cerrar</ThemedText>
                </Pressable>
              </View>

              <KeyboardAvoidingView
                style={styles.keyboardArea}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView
                  contentContainerStyle={styles.formContent}
                  keyboardShouldPersistTaps="handled">
                  {formError ? (
                    <View style={[styles.banner, { borderColor: DANGER }]}>
                      <ThemedText
                        type="small"
                        style={{ color: DANGER, flex: 1 }}>
                        {formError}
                      </ThemedText>
                    </View>
                  ) : null}

                  {formNotice ? (
                    <View style={[styles.banner, { borderColor: SUCCESS }]}>
                      <ThemedText
                        type="small"
                        style={{ color: SUCCESS, flex: 1 }}>
                        {formNotice}
                      </ThemedText>
                    </View>
                  ) : null}

                  <FormField label="Nombre" required>
                    <TextInput
                      value={form.name}
                      onChangeText={(value) => setField('name', value)}
                      placeholder="Ej. Puerta principal"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="sentences"
                      maxLength={150}
                      editable={!isSaving}
                      style={[
                        styles.input,
                        {
                          borderColor: theme.backgroundSelected,
                          color: theme.text,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                    />
                  </FormField>

                  <FormField
                    label="Código"
                    hint={
                      editing
                        ? 'Déjelo vacío para conservar el código actual.'
                        : 'Opcional. Se genera automáticamente si se deja vacío.'
                    }>
                    <TextInput
                      value={form.code}
                      onChangeText={(value) =>
                        setField('code', value.toUpperCase())
                      }
                      placeholder="Ej. PT-001"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={100}
                      editable={!isSaving}
                      style={[
                        styles.input,
                        {
                          borderColor: theme.backgroundSelected,
                          color: theme.text,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                    />
                  </FormField>

                  <FormField label="Ubicación / referencia">
                    <TextInput
                      value={form.location_description}
                      onChangeText={(value) =>
                        setField('location_description', value)
                      }
                      placeholder="Ej. Pasillo norte, piso 2"
                      placeholderTextColor={theme.textSecondary}
                      maxLength={2000}
                      editable={!isSaving}
                      multiline
                      style={[
                        styles.input,
                        styles.multilineInput,
                        {
                          borderColor: theme.backgroundSelected,
                          color: theme.text,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                    />
                  </FormField>

                  <View
                    style={[
                      styles.typeCard,
                      { borderColor: theme.backgroundSelected },
                    ]}>
                    <View style={styles.typeCardHeader}>
                      <View
                        style={[
                          styles.badge,
                          pointBadgeStyle(selectedPointType),
                        ]}>
                        <ThemedText
                          type="small"
                          style={styles.badgeTextDark}>
                          Punto {selectedPointType}
                        </ThemedText>
                      </View>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {isNfcCompany
                        ? 'El tipo de punto lo define la empresa. Registre el UID impreso en la etiqueta NFC para que los guardias puedan marcarla.'
                        : 'El tipo de punto lo define la empresa. Capture la ubicación GPS real del punto para validar la geovalla durante las rondas QR.'}
                    </ThemedText>

                    {isNfcCompany ? (
                      <FormField
                        label="UID de la etiqueta NFC"
                        hint="Opcional. Puede registrarse después. Se guarda en mayúsculas y sin separadores.">
                        <TextInput
                          value={form.uid_nfc}
                          onChangeText={(value) =>
                            setField('uid_nfc', normalizeNfcUid(value))
                          }
                          placeholder="Ej. 04A1B2C3D4E5F6"
                          placeholderTextColor={theme.textSecondary}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={100}
                          editable={!isSaving}
                          style={[
                            styles.input,
                            styles.monoInput,
                            {
                              borderColor: theme.backgroundSelected,
                              color: theme.text,
                              backgroundColor: theme.backgroundElement,
                            },
                          ]}
                        />
                      </FormField>
                    ) : (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Capturar la ubicación GPS actual"
                          accessibilityState={{
                            disabled: isSaving || isCapturingGps,
                            busy: isCapturingGps,
                          }}
                          disabled={isSaving || isCapturingGps}
                          onPress={() => {
                            void handleCaptureGps();
                          }}
                          style={({ pressed }) => [
                            styles.gpsButton,
                            {
                              borderColor: ACCENT,
                              opacity:
                                isSaving || isCapturingGps
                                  ? 0.6
                                  : pressed
                                    ? 0.8
                                    : 1,
                            },
                          ]}>
                          {isCapturingGps ? (
                            <ActivityIndicator color={ACCENT} />
                          ) : (
                            <>
                              <ThemedText
                                type="smallBold"
                                style={{ color: ACCENT }}>
                                Capturar GPS actual
                              </ThemedText>
                              <ThemedText
                                type="small"
                                themeColor="textSecondary">
                                Usa la ubicación del dispositivo
                              </ThemedText>
                            </>
                          )}
                        </Pressable>

                        <View style={styles.coordinateRow}>
                          <View style={styles.coordinateField}>
                            <FormField label="Latitud">
                              <TextInput
                                value={form.latitude}
                                onChangeText={(value) =>
                                  setField('latitude', value)
                                }
                                placeholder="-12.046374"
                                placeholderTextColor={theme.textSecondary}
                                keyboardType="numbers-and-punctuation"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isSaving}
                                style={[
                                  styles.input,
                                  styles.monoInput,
                                  {
                                    borderColor: theme.backgroundSelected,
                                    color: theme.text,
                                    backgroundColor: theme.backgroundElement,
                                  },
                                ]}
                              />
                            </FormField>
                          </View>
                          <View style={styles.coordinateField}>
                            <FormField label="Longitud">
                              <TextInput
                                value={form.longitude}
                                onChangeText={(value) =>
                                  setField('longitude', value)
                                }
                                placeholder="-77.042793"
                                placeholderTextColor={theme.textSecondary}
                                keyboardType="numbers-and-punctuation"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isSaving}
                                style={[
                                  styles.input,
                                  styles.monoInput,
                                  {
                                    borderColor: theme.backgroundSelected,
                                    color: theme.text,
                                    backgroundColor: theme.backgroundElement,
                                  },
                                ]}
                              />
                            </FormField>
                          </View>
                        </View>
                        <ThemedText type="small" themeColor="textSecondary">
                          Las coordenadas son opcionales, pero se recomiendan
                          para validar la geovalla del QR.
                        </ThemedText>
                      </>
                    )}
                  </View>

                  <FormField
                    label="Radio de geovalla (metros)"
                    hint="Entre 10 y 1000 m. Se usa para calcular la distancia al punto.">
                    <TextInput
                      value={form.geofence_radius_m}
                      onChangeText={(value) =>
                        setField('geofence_radius_m', value)
                      }
                      placeholder={String(DEFAULT_GEOFENCE_METERS)}
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="number-pad"
                      maxLength={4}
                      editable={!isSaving}
                      style={[
                        styles.input,
                        {
                          borderColor: theme.backgroundSelected,
                          color: theme.text,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                    />
                  </FormField>

                  <ThemedView
                    type="backgroundElement"
                    style={styles.switchRow}>
                    <View style={styles.switchBody}>
                      <ThemedText type="smallBold">Punto activo</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Al desactivarlo no se incluirá en rondas nuevas, pero se
                        conserva en el histórico.
                      </ThemedText>
                    </View>
                    <Switch
                      value={form.is_active}
                      onValueChange={(value) => setField('is_active', value)}
                      disabled={isSaving}
                      trackColor={{
                        false: theme.backgroundSelected,
                        true: ACCENT,
                      }}
                      thumbColor="#FFFFFF"
                      accessibilityLabel="Punto activo"
                    />
                  </ThemedView>
                </ScrollView>
              </KeyboardAvoidingView>

              <View
                style={[
                  styles.modalFooter,
                  { borderTopColor: theme.backgroundSelected },
                ]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar edición"
                  disabled={isSaving || isCapturingGps}
                  onPress={closeForm}
                  style={({ pressed }) => [
                    styles.footerButton,
                    {
                      borderColor: theme.backgroundSelected,
                      opacity:
                        isSaving || isCapturingGps ? 0.5 : pressed ? 0.8 : 1,
                    },
                  ]}>
                  <ThemedText type="smallBold">Cancelar</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    editing ? 'Guardar cambios del punto' : 'Crear punto'
                  }
                  accessibilityState={{ disabled: isSaving, busy: isSaving }}
                  disabled={isSaving || isCapturingGps}
                  onPress={() => {
                    void handleSubmit();
                  }}
                  style={({ pressed }) => [
                    styles.footerButton,
                    styles.saveButton,
                    {
                      opacity:
                        isSaving || isCapturingGps
                          ? 0.65
                          : pressed
                            ? 0.85
                            : 1,
                    },
                  ]}>
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText
                      type="smallBold"
                      style={styles.saveButtonText}>
                      {editing ? 'Guardar cambios' : 'Crear punto'}
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </SafeAreaView>
          </ThemedView>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

interface FormFieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

/** Etiqueta + control + ayuda, con el mismo espaciado en todo el formulario. */
function FormField({ label, hint, required = false, children }: FormFieldProps) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">
        {label}
        {required ? <ThemedText style={{ color: DANGER }}> *</ThemedText> : null}
      </ThemedText>
      {children}
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

function pointBadgeStyle(type: PointType) {
  return {
    backgroundColor: type === 'NFC' ? '#EDE9FE' : '#DBEAFE',
    borderColor: type === 'NFC' ? '#C4B5FD' : '#93C5FD',
  };
}

interface CheckpointCardProps {
  checkpoint: Checkpoint;
  canManage: boolean;
  isToggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
}

function CheckpointCard({
  checkpoint,
  canManage,
  isToggling,
  onEdit,
  onToggle,
}: CheckpointCardProps) {
  const theme = useTheme();
  const pointType = pointTypeOf(checkpoint);
  const coordinates = formatCoordinates(checkpoint);
  const hasNfcUid = Boolean(checkpoint.uid_nfc);

  const trackingLabel =
    pointType === 'NFC'
      ? hasNfcUid
        ? `UID ${checkpoint.uid_nfc}`
        : 'UID NFC pendiente de registrar'
      : coordinates
        ? `GPS ${coordinates}`
        : 'Sin coordenadas GPS (opcional)';

  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.card, !checkpoint.is_active && styles.inactiveCard]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleBody}>
          <ThemedText type="smallBold">{checkpoint.name}</ThemedText>
          <ThemedText type="code" themeColor="textSecondary">
            {checkpoint.code}
          </ThemedText>
        </View>
        <View style={styles.cardBadges}>
          <View style={[styles.badge, pointBadgeStyle(pointType)]}>
            <ThemedText type="small" style={styles.badgeTextDark}>
              {pointType}
            </ThemedText>
          </View>
          <View
            style={[
              styles.badge,
              checkpoint.is_active
                ? styles.activeBadge
                : styles.inactiveBadge,
            ]}>
            <ThemedText
              type="small"
              style={checkpoint.is_active ? styles.activeText : styles.inactiveText}>
              {checkpoint.is_active ? 'Activo' : 'Inactivo'}
            </ThemedText>
          </View>
        </View>
      </View>

      {checkpoint.location_description ? (
        <ThemedText type="small">{checkpoint.location_description}</ThemedText>
      ) : null}

      <View style={styles.metaList}>
        <ThemedText type="small" themeColor="textSecondary">
          {trackingLabel}
        </ThemedText>
        {pointType === 'QR' && !coordinates ? (
          <ThemedText type="small" style={{ color: WARNING }}>
            Puede agregar la ubicación desde «Editar» con el botón de GPS.
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Geovalla: {checkpoint.geofence_radius_m ?? DEFAULT_GEOFENCE_METERS} m
        </ThemedText>
      </View>

      {canManage ? (
        <View style={styles.cardActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Editar ${checkpoint.name}`}
            onPress={onEdit}
            style={({ pressed }) => [
              styles.cardButton,
              {
                borderColor: theme.backgroundSelected,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <ThemedText type="smallBold">Editar</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${
              checkpoint.is_active ? 'Desactivar' : 'Reactivar'
            } ${checkpoint.name}`}
            accessibilityState={{ disabled: isToggling, busy: isToggling }}
            disabled={isToggling}
            onPress={onToggle}
            style={({ pressed }) => [
              styles.cardButton,
              {
                borderColor: checkpoint.is_active
                  ? theme.backgroundSelected
                  : SUCCESS,
                opacity: isToggling ? 0.55 : pressed ? 0.7 : 1,
              },
            ]}>
            {isToggling ? (
              <ActivityIndicator
                color={checkpoint.is_active ? DANGER : SUCCESS}
              />
            ) : (
              <ThemedText
                type="smallBold"
                style={{
                  color: checkpoint.is_active ? DANGER : SUCCESS,
                }}>
                {checkpoint.is_active ? 'Desactivar' : 'Reactivar'}
              </ThemedText>
            )}
          </Pressable>
        </View>
      ) : null}
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
  screenHeader: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  titleBody: {
    flex: 1,
    gap: Spacing.one,
  },
  backButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  stateContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  listHeader: {
    gap: Spacing.three,
    paddingBottom: Spacing.one,
  },
  banner: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  bannerBody: {
    flex: 1,
    gap: Spacing.half,
  },
  bannerAction: {
    borderWidth: 1,
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  singleCompany: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  singleCompanyBody: {
    flex: 1,
    gap: Spacing.half,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeTextDark: {
    color: '#1F2937',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  filterChipTextSelected: {
    color: '#FFFFFF',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  newButton: {
    backgroundColor: ACCENT,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  newButtonText: {
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.three,
  },
  emptyText: {
    textAlign: 'center',
  },
  loadMoreButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  inactiveCard: {
    opacity: 0.72,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitleBody: {
    flex: 1,
    gap: Spacing.half,
  },
  cardBadges: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  activeBadge: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  inactiveBadge: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  activeText: {
    color: SUCCESS,
  },
  inactiveText: {
    color: '#4B5563',
  },
  metaList: {
    gap: Spacing.half,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  cardButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 96,
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
  },
  modalSafeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  closeButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  keyboardArea: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 44,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  monoInput: {
    fontFamily: 'monospace',
  },
  typeCard: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  typeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gpsButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
    minHeight: 56,
    justifyContent: 'center',
  },
  coordinateRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  coordinateField: {
    flex: 1,
  },
  switchRow: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  switchBody: {
    flex: 1,
    gap: Spacing.half,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  footerButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  saveButton: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  saveButtonText: {
    color: '#FFFFFF',
  },
});

