import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner() {
  const theme = useTheme();
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View
      style={[styles.banner, { backgroundColor: theme.colors.warningSurface }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[theme.typography.caption, { color: theme.colors.warning, textAlign: 'center' }]}>
        You&rsquo;re offline. Some actions won&rsquo;t work until you&rsquo;re back online.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 6, paddingHorizontal: 12 },
});
