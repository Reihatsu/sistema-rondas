/**
 * Modal reutilizable para pedir un comentario obligatorio.
 *
 * Se usa al pausar (motivo de la pausa), al cancelar (motivo de la
 * cancelación) y para añadir una nota operativa a la ronda. En Android
 * `Alert.prompt` no existe, por eso el formulario se implementa con `Modal`.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#208AEF';
const DANGER = '#D93025';

export interface CommentPromptModalProps {
  visible: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  minLength?: number;
  maxLength?: number;
  /** Pinta el botón de confirmación en rojo (cancelar ronda). */
  destructive?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}

export function CommentPromptModal({
  visible,
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  minLength = 2,
  maxLength = 1000,
  destructive = false,
  isSubmitting = false,
  error = null,
  onCancel,
  onSubmit,
}: CommentPromptModalProps) {
  const theme = useTheme();
  const [text, setText] = useState('');

  // Cada vez que se abre el modal se empieza con el campo vacío.
  useEffect(() => {
    if (visible) {
      setText('');
    }
  }, [visible]);

  const trimmed = text.trim();
  const canSubmit = trimmed.length >= minLength && !isSubmitting;
  const actionColor = destructive ? DANGER : ACCENT;

  function handleSubmit() {
    if (canSubmit) {
      onSubmit(trimmed);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Cerrar formulario"
          onPress={isSubmitting ? undefined : onCancel}
        />

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{title}</ThemedText>

          {description ? (
            <ThemedText type="small" themeColor="textSecondary">
              {description}
            </ThemedText>
          ) : null}

          <ThemedText type="code" themeColor="textSecondary">
            {label}
          </ThemedText>

          <TextInput
            accessibilityLabel={label}
            autoFocus
            multiline
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            maxLength={maxLength}
            editable={!isSubmitting}
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.background,
                borderColor: theme.backgroundSelected,
              },
            ]}
          />

          <ThemedText type="code" themeColor="textSecondary" style={styles.counter}>
            {trimmed.length}/{maxLength}
          </ThemedText>

          {error ? (
            <ThemedText type="small" style={styles.errorText}>
              {error}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancelar y volver a la ronda"
              accessibilityState={{ disabled: isSubmitting }}
              disabled={isSubmitting}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: theme.backgroundSelected,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}>
              <ThemedText type="smallBold">Volver</ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: canSubmit ? actionColor : theme.backgroundSelected,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText
                  type="smallBold"
                  style={canSubmit ? styles.onAccent : { color: theme.textSecondary }}>
                  {confirmLabel}
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  input: {
    minHeight: 96,
    maxHeight: 180,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  counter: {
    textAlign: 'right',
  },
  errorText: {
    color: DANGER,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1.4,
    minHeight: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onAccent: {
    color: '#FFFFFF',
  },
});

