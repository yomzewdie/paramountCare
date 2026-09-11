import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ProgressBarProps {
  percent: number;
  label?: string;
}

/** The percentage is always shown as text alongside the bar — progress must
 * be understandable without color alone (M4 accessibility requirement). */
export function ProgressBar({ percent, label }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <View>
      {label ? (
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
          {label} — {clamped}% complete
        </Text>
      ) : null}
      <View
        style={[styles.track, { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.full }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: clamped }}
        accessibilityLabel={label ? `${label}, ${clamped} percent complete` : `${clamped} percent complete`}
      >
        <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: theme.colors.primary, borderRadius: theme.radii.full }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, overflow: 'hidden', width: '100%' },
  fill: { height: '100%' },
});
