import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Masks a value except its last 4 digits when not focused/revealed — the
 * exact behavior the existing web SensitiveInput (SSN masking) already
 * implements: `***-**-1234` at rest, the real formatted value while
 * actively editing or after tapping "Show." No OS-level secureTextEntry
 * (which hides every character with no partial reveal) — this is a
 * deliberate, existing product security pattern being matched, not a new
 * one invented for mobile. No icon library exists anywhere else in this
 * app (every status glyph is plain text — see StepRow), so the reveal
 * toggle is a plain "Show"/"Hide" text button, not a new icon dependency.
 */

function formatSSN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function maskSSN(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  if (digits.length < 4) return '•'.repeat(digits.length);
  return `***-**-${digits.slice(-4)}`;
}

interface SensitiveFieldProps {
  label: string;
  value: string;
  onChangeText: (formatted: string) => void;
  required?: boolean;
  error?: string;
  hint?: string;
}

export function SensitiveField({ label, value, onChangeText, required, error, hint }: SensitiveFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const showRaw = focused || revealed;
  const displayValue = showRaw ? value : (value ? maskSSN(value) : '');

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
        {label}
        {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
      </Text>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={displayValue}
          onChangeText={(t) => onChangeText(formatSSN(t))}
          onFocus={() => { setFocused(true); setRevealed(false); }}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          autoComplete="off"
          textContentType="none"
          placeholder="XXX-XX-XXXX"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={required ? `${label}, required` : label}
          style={[
            styles.input,
            {
              minHeight: theme.minTouchTarget,
              borderRadius: theme.radii.sm,
              borderColor: error ? theme.colors.danger : theme.colors.border,
              backgroundColor: theme.colors.surface,
              color: theme.colors.text,
              paddingRight: value ? 64 : 12,
            },
          ]}
        />
        {value && !focused ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide value' : 'Show value'}
            style={styles.revealButton}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
              {revealed ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : null}
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
  input: { borderWidth: 1, paddingHorizontal: 12, fontSize: 16, fontVariant: ['tabular-nums'] },
  revealButton: { position: 'absolute', right: 12, paddingVertical: 8, paddingHorizontal: 4 },
});
