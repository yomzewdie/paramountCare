import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useKeyboardScroll } from './keyboard/KeyboardScrollContext';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  /** Shows a required indicator next to the label — presentation only, does
   * not itself enforce anything (the actual rule comes from @pcs/shared's
   * validation). */
  required?: boolean;
  /** Helper text shown below the field when there's no error — e.g. "Optional". */
  hint?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, required, hint, style, ...rest },
  ref,
) {
  const theme = useTheme();
  const { ensureFocusedInputVisible } = useKeyboardScroll();

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
        {label}
        {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={required ? `${label}, required` : label}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          styles.input,
          {
            minHeight: theme.minTouchTarget,
            borderRadius: theme.radii.sm,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
          },
          style,
        ]}
        {...rest}
        onFocus={(e) => {
          rest.onFocus?.(e);
          ensureFocusedInputVisible();
        }}
        // A multiline field grows as the applicant types; keep the caret line above the keyboard/footer.
        onContentSizeChange={(e) => {
          rest.onContentSizeChange?.(e);
          if (rest.multiline) ensureFocusedInputVisible();
        }}
      />
      {error ? (
        // A live region so screen readers announce the error the moment it
        // appears, without the user needing to discover it by touch —
        // "focus behavior for form errors" / "screen-reader-friendly error
        // messages" from the M3 accessibility requirements.
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
});
