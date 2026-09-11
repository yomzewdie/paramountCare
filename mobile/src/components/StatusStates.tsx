import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

// Four small, consistent full-area states, used the same way across every
// screen rather than each screen inventing its own loading/error/empty
// treatment. Kept together in one file since each is a handful of lines.

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: theme.spacing.md }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.center, { backgroundColor: theme.colors.dangerSurface, borderRadius: theme.radii.md, padding: theme.spacing.lg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.danger, textAlign: 'center' }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: theme.spacing.md, alignSelf: 'stretch' }}>
          <Button label="Try again" onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function SuccessState({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.center, { backgroundColor: theme.colors.successSurface, borderRadius: theme.radii.md, padding: theme.spacing.lg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.success, textAlign: 'center' }]}>{message}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <Text style={[theme.typography.title, { color: theme.colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing.sm }]}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
