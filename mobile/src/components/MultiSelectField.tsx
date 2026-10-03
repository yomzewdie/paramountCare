import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { SelectOption } from './SelectField';

interface MultiSelectFieldProps {
  label: string;
  /** Selected option values. */
  values: string[];
  /** Called with the option the applicant tapped — the caller decides how
   * that toggles its stored selection. */
  onToggle: (value: string) => void;
  options: readonly SelectOption[];
  required?: boolean;
  /** Helper text shown below the options when there's no error. */
  hint?: string;
  error?: string;
}

/**
 * A "select all that apply" field — inline toggle chips, the same visual
 * language as YesNoField (bordered option, primary fill when selected), so
 * every option stays visible without opening a modal. Built for the
 * Employment Application's unit and shift preferences; reusable for any
 * future multi-choice field.
 */
export function MultiSelectField({ label, values, onToggle, options, required, hint, error }: MultiSelectFieldProps) {
  const theme = useTheme();

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
        {label}
        {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
      </Text>
      <View accessibilityLabel={`${label}${required ? ', required' : ''}`} style={[styles.options, { gap: theme.spacing.sm }]}>
        {options.map((opt) => {
          const selected = values.includes(opt.value);
          return (
            <Pressable
              key={opt.value}
              onPress={() => onToggle(opt.value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={opt.label}
              style={[
                styles.option,
                {
                  minHeight: theme.minTouchTarget,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.sm,
                  borderColor: selected ? theme.colors.primary : error ? theme.colors.danger : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                },
              ]}
            >
              <Text style={[theme.typography.bodyStrong, { color: selected ? theme.colors.surface : theme.colors.text }]}>
                {selected ? '✓ ' : ''}{opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
