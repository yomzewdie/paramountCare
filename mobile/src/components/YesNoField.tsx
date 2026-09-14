import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface YesNoFieldProps {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  required?: boolean;
  error?: string;
}

/**
 * A two-button Yes/No toggle — the smallest accessible new primitive the
 * Employment Reference form actually needs (a modal-based SelectField would
 * be a worse fit for a single binary choice). Genuinely reusable: any future
 * step with a background/eligibility-style question wants the same pattern.
 */
export function YesNoField({ label, value, onChange, required, error }: YesNoFieldProps) {
  const theme = useTheme();

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
        {label}
        {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {([true, false] as const).map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={String(opt)}
              onPress={() => onChange(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${opt ? 'Yes' : 'No'}${required ? ', required' : ''}`}
              style={[
                styles.option,
                {
                  minHeight: theme.minTouchTarget,
                  borderRadius: theme.radii.sm,
                  borderColor: selected ? theme.colors.primary : error ? theme.colors.danger : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                },
              ]}
            >
              <Text style={[theme.typography.bodyStrong, { color: selected ? theme.colors.surface : theme.colors.text }]}>
                {opt ? 'Yes' : 'No'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flex: 1, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
