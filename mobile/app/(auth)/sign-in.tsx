import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/StatusStates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthContext';
import type { AppError } from '../../src/utils/errors';

export default function SignIn() {
  const theme = useTheme();
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function handleSubmit() {
    if (isSubmitting || !email || !password) return;
    setError(null);
    setIsSubmitting(true);
    const result = await signIn(email.trim().toLowerCase(), password);
    setIsSubmitting(false);

    if (!result.ok) {
      // A clear next action rather than a dead end: an unverified account
      // goes straight to the verification screen instead of just showing an
      // error the applicant can't act on from here.
      if (result.error.code === 'email_not_verified') {
        router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim().toLowerCase() } });
        return;
      }
      setError(result.error);
      return;
    }
    // Success is handled by (auth)/_layout.tsx's guard, which redirects to
    // (app)/home the moment AuthContext's status becomes 'signedIn' — no
    // explicit navigation needed here.
  }

  return (
    <Screen>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.lg }]}>Sign in</Text>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />

      {error ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <ErrorState message={error.message} />
        </View>
      ) : null}

      <Button label="Sign in" onPress={handleSubmit} loading={isSubmitting} disabled={!email || !password} />

      <View style={{ marginTop: theme.spacing.md, alignItems: 'center' }}>
        <Button label="Need an account? Use your invitation" variant="secondary" onPress={() => router.push('/(auth)/register')} />
      </View>
    </Screen>
  );
}
