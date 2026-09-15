import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface StepRowProps {
  label: string;
  completed: boolean;
  /** From the packet's own PacketStep.required — defaults to true so
   * existing callers that don't pass it render exactly as before. When
   * false, an explicit "Optional" text label is shown (M10) — never
   * communicated by color alone, so it reads correctly in
   * grayscale/high-contrast modes and to screen readers. */
  required?: boolean;
  /** Omit for a read-only summary row (dashboard); provide for a tappable
   * row (the full step list) — the same component serves both because the
   * only real difference is interactivity. */
  onPress?: () => void;
}

export function StepRow({ label, completed, required = true, onPress }: StepRowProps) {
  const theme = useTheme();
  // Completion is never conveyed by the glyph/color alone — the
  // accessibilityLabel below states "completed"/"not completed" in words,
  // and the glyph itself (✓ vs ○) is a shape difference, not just a color
  // difference, so it also reads clearly in grayscale/high-contrast modes.
  const statusLabel = completed ? 'completed' : 'not completed';
  const optionalLabel = required ? '' : ', optional';

  const content = (
    <View style={[styles.row, { paddingVertical: theme.spacing.sm }]}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.glyph, { color: completed ? theme.colors.success : theme.colors.textMuted }]}
      >
        {completed ? '✓' : '○'}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.body, { color: theme.colors.text }]}>{label}</Text>
        {!required ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Optional</Text>
        ) : null}
      </View>
      {onPress ? <Text style={{ color: theme.colors.textMuted }}>›</Text> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}${optionalLabel}, ${statusLabel}`}
        hitSlop={4}
        style={({ pressed }) => [{ minHeight: theme.minTouchTarget, justifyContent: 'center', opacity: pressed ? 0.7 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={`${label}${optionalLabel}, ${statusLabel}`}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  glyph: { fontSize: 18, width: 22, textAlign: 'center' },
});
