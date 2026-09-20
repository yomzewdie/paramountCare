import Constants from 'expo-constants';
import { Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthContext';

// Deliberately lightweight (app-shell modernization spec): applicant email,
// sign out, app version. NOT account editing, password change,
// notification preferences, or support ticketing — none of that exists
// anywhere in this app today, and this screen doesn't pretend otherwise.
export default function Profile() {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  return (
    <Screen scroll={false}>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.lg }]}>Profile</Text>

      <Card style={{ marginBottom: theme.spacing.lg }}>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.xs }]}>Signed in as</Text>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{user?.email ?? '—'}</Text>
      </Card>

      <View style={{ marginBottom: theme.spacing.lg }}>
        <Button label="Sign Out" variant="secondary" onPress={() => void signOut()} />
      </View>

      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, textAlign: 'center' }]}>
        Paramount Care Staffing — v{Constants.expoConfig?.version ?? '—'}
      </Text>
    </Screen>
  );
}
