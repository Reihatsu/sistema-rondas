/**
 * Selector de empresa para iniciar una ronda.
 *
 * Un guardia puede tener varias empresas activas asignadas. El backend crea la
 * ronda con los checkpoints de la empresa elegida (`POST /rounds/start-new`
 * acepta `company_id`), así que la pantalla debe dejar claro qué empresa se
 * usará y qué tecnología de puntos tiene configurada (QR o NFC), porque de ella
 * depende el modo del escáner.
 * La UI es un desplegable compacto: el encabezado muestra la empresa elegida y
 * la lista de opciones solo se abre al pulsarlo. Se deshabilita por completo
 * mientras hay una operación en curso o una ronda activa.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { CompanySummary, PointType } from '@/api/types';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#208AEF';

/** Texto de ayuda según la tecnología configurada en la empresa. */
export const POINT_TYPE_HINTS: Record<PointType, string> = {
  QR: 'Puntos QR: escanee el código impreso y valide su ubicación GPS.',
  NFC: 'Puntos NFC: acerque el móvil a la etiqueta del punto de control.',
};

const POINT_TYPE_LABELS: Record<PointType, string> = {
  QR: 'QR',
  NFC: 'NFC',
};

export interface CompanyPickerProps {
  /** Empresas activas asignadas al guardia. */
  companies: CompanySummary[];
  /** Empresa elegida; si es `null` se resalta la primera (o «Todas»). */
  selectedCompanyId: number | null;
  onSelect: (companyId: number | null) => void;
  /** Bloquea la apertura y la selección (ronda activa u operación en curso). */
  disabled?: boolean;
  title?: string;
  /** Oculta la ayuda de tecnología y el texto inferior (para filtros). */
  compact?: boolean;
  /** Añade una opción «Todas» que emite `null` (filtros del historial). */
  allowAll?: boolean;
  allLabel?: string;
}

export function CompanyPicker({
  companies,
  selectedCompanyId,
  onSelect,
  disabled = false,
  title = 'Empresa de la ronda',
  compact = false,
  allowAll = false,
  allLabel = 'Todas las empresas',
}: CompanyPickerProps) {
  const theme = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  // Una ronda activa o una petición en curso debe cerrar el desplegable para
  // que el selector quede realmente bloqueado.
  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  if (companies.length === 0) {
    return null;
  }

  const selected =
    selectedCompanyId === null && allowAll
      ? null
      : (companies.find((company) => company.id === selectedCompanyId) ??
        companies[0]);
  const selectedName = selected?.name ?? allLabel;
  const canOpen = !disabled && (companies.length > 1 || allowAll);

  return (
    <View style={styles.container}>
      {!compact && title ? (
        <ThemedText type="smallBold">{title}</ThemedText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${selectedName}. ${
          canOpen ? 'Toca para cambiar de empresa' : 'Empresa seleccionada'
        }`}
        accessibilityState={{ disabled: !canOpen, expanded: isOpen }}
        disabled={!canOpen}
        onPress={() => setIsOpen((value) => !value)}
        style={({ pressed }) => [
          styles.trigger,
          {
            borderColor: isOpen ? ACCENT : theme.backgroundSelected,
            backgroundColor: theme.backgroundElement,
            opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}>
        <View style={styles.triggerBody}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.companyName}>
            {selectedName}
          </ThemedText>
          {selected ? (
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor:
                    selected.point_type === 'NFC' ? '#6B4EFF' : ACCENT,
                },
              ]}>
              <ThemedText type="code" style={styles.onAccent}>
                {POINT_TYPE_LABELS[selected.point_type] ?? selected.point_type}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <ThemedText
          type="smallBold"
          style={{ color: canOpen ? ACCENT : theme.textSecondary }}>
          {canOpen ? (isOpen ? 'Cerrar' : 'Cambiar') : 'Fija'}
        </ThemedText>
      </Pressable>

      {isOpen ? (
        <View
          accessibilityRole="menu"
          style={[
            styles.options,
            {
              borderColor: theme.backgroundSelected,
              backgroundColor: theme.backgroundElement,
            },
          ]}>
          {allowAll ? (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={`${allLabel}, sin filtro de empresa`}
              accessibilityState={{ selected: selected === null, disabled }}
              disabled={disabled}
              onPress={() => {
                onSelect(null);
                setIsOpen(false);
              }}
              style={({ pressed }) => [
                styles.option,
                selected === null && { backgroundColor: theme.backgroundSelected },
                { opacity: pressed ? 0.75 : 1 },
              ]}>
              <ThemedText
                type={selected === null ? 'smallBold' : 'small'}
                numberOfLines={1}
                style={styles.optionName}>
                {allLabel}
              </ThemedText>
              <ThemedText type="code" themeColor="textSecondary">
                {selected === null ? '✓' : ''}
              </ThemedText>
            </Pressable>
          ) : null}

          {companies.map((company) => {
            const isSelected = company.id === selected?.id;

            return (
              <Pressable
                key={company.id}
                accessibilityRole="menuitem"
                accessibilityLabel={
                  isSelected
                    ? `${company.name}, empresa seleccionada`
                    : `Seleccionar la empresa ${company.name}`
                }
                accessibilityState={{ selected: isSelected, disabled }}
                disabled={disabled}
                onPress={() => {
                  onSelect(company.id);
                  setIsOpen(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && { backgroundColor: theme.backgroundSelected },
                  { opacity: pressed ? 0.75 : 1 },
                ]}>
                <ThemedText
                  type={isSelected ? 'smallBold' : 'small'}
                  numberOfLines={1}
                  style={styles.optionName}>
                  {company.name}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary">
                  {POINT_TYPE_LABELS[company.point_type] ?? company.point_type}
                  {isSelected ? '  ✓' : ''}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {!compact && selected ? (
        <ThemedText type="small" themeColor="textSecondary">
          {POINT_TYPE_HINTS[selected.point_type] ?? POINT_TYPE_HINTS.QR}
        </ThemedText>
      ) : null}

      {!compact && companies.length > 1 ? (
        <ThemedText type="small" themeColor="textSecondary">
          La ronda se crea únicamente con los puntos activos de la empresa
          seleccionada.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  trigger: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  triggerBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  companyName: {
    flexShrink: 1,
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  onAccent: {
    color: '#FFFFFF',
  },
  options: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  option: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  optionName: {
    flex: 1,
  },
});
