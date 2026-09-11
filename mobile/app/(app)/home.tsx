import { Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthContext';

// Deliberately a placeholder, not the "My Onboarding" dashboard from
// docs/PRODUCT_ROADMAP.md item #3 — that's near-term work scheduled after
// M3, once there's a real onboarding session to show progress against. This
// screen exists to prove the authenticated-navigation architecture: reaching
// it at all means sign-in → token storage → guarded routing all worked.
export default function Home() {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  return (
    <Screen>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.lg }]}>My Onboarding</Text>

      <Card style={{ marginBottom: theme.spacing.lg }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>Signed in as</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>{user?.email}</Text>
      </Card>

      <View style={{ marginTop: 'auto' }}>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}
