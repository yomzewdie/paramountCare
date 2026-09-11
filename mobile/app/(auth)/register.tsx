import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { ErrorState } from '../../src/components/StatusStates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthContext';
import { appError, type AppError } from '../../src/utils/errors';

// The invite token arrives one of two ways: as a `token` route/query param
// (Expo Router auto-populates this when the app is opened via a deep link
// matching this screen's path — see README.md "Invitation / deep-link
// handling"), or typed in manually here for the case of testing without a
// live link. Either way it is held only in this screen's local state for as
// long as it takes to submit the request, never persisted, never logged,
// never sent to analytics or error reporting.
export default function Register() {
  const theme = useTheme();
  const router = useRouter();
  const { register } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();

  const [manualToken, setManualToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const tokenFromLink = typeof params.token === 'string' ? params.token : undefined;
  const effectiveToken = (tokenFromLink ?? manualToken).trim();

  function fieldError(field: string): string | undefined {
    return error?.fieldIssues?.find((i) => i.field === field)?.message;
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    setError(null);

    if (!effectiveToken) {
      setError(appError('invite_invalid'));
      return;
    }
    // Matches the Worker's actual rule exactly (registerSchema: min 8
    // characters, no other complexity requirement) — not a stricter
    // client-invented policy.
    if (password.length < 8) {
      setError({ code: 'validation', message: 'Password must be at least 8 characters', fieldIssues: [{ field: 'password', message: 'Must be at least 8 characters' }] });
      return;
    }
    if (password !== confirmPassword) {
      setError({ code: 'validation', message: 'Passwords do not match', fieldIssues: [{ field: 'confirmPassword', message: 'Passwords do not match' }] });
      return;
    }

    setIsSubmitting(true);
    const result = await register(effectiveToken, password);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.replace({ pathname: '/(auth)/verify-email', params: { email: result.data.email } });
  }

  // A confirmed-dead invitation (invalid, expired, revoked, or already used
  // — the Worker deliberately returns one generic signal for all four, to
  // avoid revealing which reason applies to an unauthenticated caller) is a
  // dead end for this screen, not a field to fix and resubmit. Replacing the
  // form with a clear, actionable blocking state is more honest than
  // leaving password fields visible above an error banner.
  if (error?.code === 'invite_invalid' && effectiveToken) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState message={error.message} />
          <View style={{ marginTop: theme.spacing.lg }}>
            <Button label="Back to Sign In" variant="secondary" onPress={() => router.replace('/(auth)/sign-in')} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginBottom: theme.spacing.xs }]}>
        PARAMOUNT CARE
      </Text>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Create your account</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        {tokenFromLink
          ? 'Paramount Care Staffing has invited you to complete your onboarding. Set a password to create your account and get started.'
          : 'Enter the invitation code from your email, and set a password to create your account.'}
      </Text>

      {!tokenFromLink && (
        <TextField
          label="Invitation code"
          value={manualToken}
          onChangeText={setManualToken}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Paste the code from your invitation email"
        />
      )}

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="newPassword"
        autoCapitalize="none"
        error={fieldError('password')}
      />
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }]}>
        At least 8 characters.
      </Text>
      <TextField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        textContentType="newPassword"
        autoCapitalize="none"
        error={fieldError('confirmPassword')}
      />

      {error && !error.fieldIssues ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <ErrorState message={error.message} />
        </View>
      ) : null}

      <Button label="Create account" onPress={handleSubmit} loading={isSubmitting} disabled={!effectiveToken || !password || !confirmPassword} />

      <View style={{ marginTop: theme.spacing.md, alignItems: 'center' }}>
        <Button label="Already have an account? Sign in" variant="secondary" onPress={() => router.replace('/(auth)/sign-in')} />
      </View>
    </Screen>
  );
}
