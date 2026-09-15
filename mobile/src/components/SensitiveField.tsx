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
 *
 * M13: generalized with a `variant` prop so Direct Deposit's routing/
 * account numbers reuse this same masking component rather than a second
 * one being built — 'ssn' (the default) is byte-for-byte the original
 * W-4/I-9 behavior, unchanged; 'numeric' drops the dash grouping (routing
 * and account numbers aren't dash-formatted) and masks every digit but the
 * last 4 with plain bullets, capped at `maxLength` digits.
 */

type SensitiveFieldVariant = 'ssn' | 'numeric';

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

function formatNumeric(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLength);
}

function maskNumeric(digits: string): string {
  if (digits.length <= 4) return '•'.repeat(digits.length);
  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

const DEFAULT_NUMERIC_MAX_LENGTH = 17; // generous upper bound for a US bank account number

interface SensitiveFieldProps {
  label: string;
  value: string;
  onChangeText: (formatted: string) => void;
  required?: boolean;
  error?: string;
  hint?: string;
  variant?: SensitiveFieldVariant;
  /** 'numeric' variant only — 'ssn' is always capped at 9 digits. */
  maxLength?: number;
  placeholder?: string;
}

export function SensitiveField({
  label, value, onChangeText, required, error, hint,
  variant = 'ssn', maxLength, placeholder,
}: SensitiveFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const format = (raw: string) =>
    variant === 'ssn' ? formatSSN(raw) : formatNumeric(raw, maxLength ?? DEFAULT_NUMERIC_MAX_LENGTH);
  const mask = (formatted: string) => (variant === 'ssn' ? maskSSN(formatted) : maskNumeric(formatted.replace(/\D/g, '')));

  const showRaw = focused || revealed;
  const displayValue = showRaw ? value : (value ? mask(value) : '');

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
        {label}
        {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
      </Text>
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={displayValue}
          onChangeText={(t) => onChangeText(format(t))}
          onFocus={() => { setFocused(true); setRevealed(false); }}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          autoComplete="off"
          textContentType="none"
          placeholder={placeholder ?? (variant === 'ssn' ? 'XXX-XX-XXXX' : undefined)}
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
