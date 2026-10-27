/**
 * Selector de empresa para iniciar una ronda.
 *
 * Un guardia puede tener varias empresas activas asignadas. El backend crea la
 * ronda con los checkpoints de la empresa elegida (`POST /rounds/start-new`
 * acepta `company_id`), así que la pantalla debe dejar claro qué empresa se
 * usará y qué tecnología de puntos tiene configurada (QR o NFC), porque de ella
 * depende el modo del escáner.
 */

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

export interface CompanyPickerProps {
  /** Empresas activas asignadas al guardia. */
  companies: CompanySummary[];
  /** Empresa elegida; si es `null` se resalta la primera. */
  selectedCompanyId: number | null;
  onSelect: (companyId: number) => void;
  disabled?: boolean;
  title?: string;
}

export function CompanyPicker({
  companies,
  selectedCompanyId,
  onSelect,
  disabled = false,
  title = 'Empresa de la ronda',
}: CompanyPickerProps) {
  const theme = useTheme();

  if (companies.length === 0) {
    return null;
  }

  const selected =
    companies.find((company) => company.id === selectedCompanyId) ?? companies[0];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {companies.length > 1 ? (
          <ThemedText type="code" themeColor="textSecondary">
            TOCA PARA CAMBIAR
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.chips}>
        {companies.map((company) => {
          const isSelected = company.id === selected.id;

          return (
            <Pressable
              key={company.id}
              accessibilityRole="button"
              accessibilityLabel={
                isSelected
                  ? `${company.name}, empresa seleccionada`
                  : `Seleccionar la empresa ${company.name}`
              }
              accessibilityState={{ selected: isSelected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(company.id)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: isSelected ? ACCENT : theme.backgroundSelected,
                  backgroundColor: isSelected ? ACCENT : theme.backgroundElement,
                  opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}>
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                style={{ color: isSelected ? '#FFFFFF' : theme.text }}>
                {company.name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {POINT_TYPE_HINTS[selected.point_type] ??
          POINT_TYPE_HINTS.QR}
      </ThemedText>

      {companies.length > 1 ? (
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxWidth: '100%',
  },
});
