import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function Welcome() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={[theme.typography.display, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Paramount Care</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.xl }]}>
          Applicant onboarding. Accounts are created from an invitation your Paramount Care coordinator sends you by email — open that
          link on this device to get started.
        </Text>

        <Button label="Sign In" onPress={() => router.push('/(auth)/sign-in')} />

        <View style={{ marginTop: theme.spacing.md }}>
          <Button label="I have an invitation code" variant="secondary" onPress={() => router.push('/(auth)/register')} />
        </View>
      </View>
    </Screen>
  );
}
