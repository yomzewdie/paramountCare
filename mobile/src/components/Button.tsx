import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  /** Overrides the accessible name when the visible label itself doesn't
   * read well aloud (e.g. a punctuated phone number) — optional, defaults
   * to `label`, so every existing call site is unaffected. */
  accessibilityLabel?: string;
}

/** The one button component in the app. `loading` disables it AND shows a
 * spinner in place of the label — this is what item 16 ("do not allow
 * duplicate registration/login submissions from repeated taps") relies on:
 * every submit screen passes its own `isSubmitting` state in as `loading`. */
export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false, accessibilityHint, accessibilityLabel }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  // A second guard beyond the `disabled` prop: Pressable's onPress can still
  // fire once more between a tap and the next render actually applying
  // `disabled` — this ref makes double-submission impossible even in that
  // narrow window, not just unlikely.
  const guard = useRef(false);

  const handlePress = () => {
    if (isDisabled || guard.current) return;
    guard.current = true;
    onPress();
    // Released on next tick — by then `loading`/`disabled` from the caller
    // has had a chance to take over as the real guard for anything
    // longer-lived than a single synchronous re-render.
    setTimeout(() => {
      guard.current = false;
    }, 0);
  };

  const backgroundColor = {
    primary: theme.colors.primary,
    secondary: theme.colors.surfaceAlt,
    danger: theme.colors.danger,
  }[variant];
  const textColor = variant === 'secondary' ? theme.colors.text : theme.colors.primaryText;

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor, minHeight: theme.minTouchTarget, borderRadius: theme.radii.md, opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} accessibilityLabel="Loading" />
      ) : (
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  label: { fontSize: 16, fontWeight: '600' },
});
