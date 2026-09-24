import { StyleSheet, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useKeyboardScroll } from './keyboard/KeyboardScrollContext';

interface CodeInputProps {
  value: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
}

/**
 * A single numeric input rather than six separate auto-advancing boxes.
 * Six-box code entry is a common pattern visually, but is a well-known
 * screen-reader accessibility anti-pattern (each box announces as an
 * isolated, unlabeled field) unless implemented with a lot of extra care
 * this foundation milestone doesn't need to take on. A single field with
 * `textContentType`/`autoComplete` set to the OS's one-time-code hints gets
 * the same practical benefit (SMS/email code autofill suggestions on both
 * platforms) with none of the accessibility cost.
 */
export function CodeInput({ value, onChangeText, autoFocus }: CodeInputProps) {
  const theme = useTheme();
  const { ensureFocusedInputVisible } = useKeyboardScroll();

  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, '').slice(0, 6))}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      autoFocus={autoFocus}
      onFocus={ensureFocusedInputVisible}
      accessibilityLabel="6-digit verification code"
      accessibilityHint="Enter the 6-digit code sent to your email"
      placeholder="000000"
      placeholderTextColor={theme.colors.textMuted}
      style={[
        styles.input,
        {
          minHeight: theme.minTouchTarget + 8,
          borderRadius: theme.radii.sm,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          color: theme.colors.text,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center',
  },
});
