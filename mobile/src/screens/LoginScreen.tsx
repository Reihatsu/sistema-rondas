/**
 * Pantalla de inicio de sesión.
 *
 * Envía las credenciales a `AuthProvider.login`, que persiste el JWT y hace
 * que `AppNavigator` muestre el área autenticada.
 */

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getErrorMessage } from '@/api/client';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';

/** Azul de marca (mismo color del splash configurado en app.json). */
const PRIMARY_COLOR = '#208AEF';
const DANGER_COLOR = '#D93025';

export default function LoginScreen() {
  const { login } = useAuth();
  const theme = useTheme();

  const passwordInputRef = useRef<TextInputInstance>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      // Si la autenticación es correcta, el guard de navegación desmonta esta
      // pantalla y muestra `(app)/index`.
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputStyle = [
    styles.input,
    {
      backgroundColor: theme.backgroundElement,
      borderColor: theme.backgroundSelected,
      color: theme.text,
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.content}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <ThemedText type="code" themeColor="textSecondary">
                SISTEMA DE RONDAS
              </ThemedText>
              <ThemedText type="subtitle">Iniciar sesión</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.headerHint}>
                Use la cuenta asignada por su empresa para registrar rondas y checkpoints.
              </ThemedText>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Correo electrónico
                </ThemedText>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="guardia@empresa.com"
                  placeholderTextColor={theme.textSecondary}
                  style={inputStyle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  editable={!isSubmitting}
                  accessibilityLabel="Correo electrónico"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
              </View>

              <View style={styles.field}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Contraseña
                </ThemedText>
                <TextInput
                  ref={passwordInputRef}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={theme.textSecondary}
                  style={inputStyle}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  editable={!isSubmitting}
                  accessibilityLabel="Contraseña"
                  onSubmitEditing={() => {
                    void handleSubmit();
                  }}
                />
              </View>

              {errorMessage !== null && (
                <View style={[styles.errorBox, { borderColor: DANGER_COLOR }]}>
                  <ThemedText type="small" style={styles.errorText}>
                    {errorMessage}
                  </ThemedText>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Iniciar sesión"
                accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
                disabled={!canSubmit}
                onPress={() => {
                  void handleSubmit();
                }}
                style={({ pressed }) => [
                  styles.submitButton,
                  {
                    backgroundColor: PRIMARY_COLOR,
                    opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}>
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText type="smallBold" style={styles.submitLabel}>
                    Iniciar sesión
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
    gap: Spacing.five,
  },
  header: {
    gap: Spacing.two,
  },
  headerHint: {
    maxWidth: 420,
  },
  form: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 16,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  errorText: {
    color: DANGER_COLOR,
  },
  submitButton: {
    marginTop: Spacing.two,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  submitLabel: {
    color: '#FFFFFF',
  },
});
