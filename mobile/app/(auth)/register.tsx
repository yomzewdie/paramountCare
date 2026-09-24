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

// Two-step invitation-code flow (deep links / Universal Links / App Links /
// browser registration are explicitly out of scope — see the
// invitation-code-flow design notes). Step 1 collects and validates the
// code; step 2 shows the invited (masked) email and collects a password.
// A successful "Create account" both claims the invite AND signs the
// applicant in (see AuthContext.register) — there is no separate
// email-verification screen or sign-in step after this.
type Step = 'code' | 'password';

export default function Register() {
  const theme = useTheme();
  const router = useRouter();
  const { register, validateInviteCode } = useAuth();

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  function fieldError(field: string): string | undefined {
    return error?.fieldIssues?.find((i) => i.field === field)?.message;
  }

  async function handleContinue() {
    if (isSubmitting || !code.trim()) return;
    setError(null);
    setIsSubmitting(true);
    const result = await validateInviteCode(code.trim());
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMaskedEmail(result.data.email);
    setStep('password');
  }

  async function handleCreateAccount() {
    if (isSubmitting) return;
    setError(null);

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
    const result = await register(code.trim(), password);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      // A code that was valid moments ago but is now dead (used/revoked/
      // expired in the interim) sends the applicant back to step 1 to enter
      // a fresh one, rather than stranding them on a password form for a
      // code that will never work.
      if (result.error.code === 'invite_invalid') {
        setStep('code');
      }
      return;
    }

    // AuthContext.register already stored tokens and set status to
    // 'signedIn' on success — the (auth) layout's own redirect takes it from
    // here into onboarding. No navigation call needed.
  }

  if (step === 'code') {
    return (
      <Screen>
        <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginBottom: theme.spacing.xs }]}>
          PARAMOUNT CARE
        </Text>
        <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>
          Enter your invitation code
        </Text>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
          Check the email from Paramount Care Staffing for your invitation code.
        </Text>

        <TextField
          label="Invitation code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="e.g. ABCD-EFGH-J2"
          error={fieldError('code')}
        />

        {error && !error.fieldIssues ? (
          <View style={{ marginBottom: theme.spacing.md }}>
            <ErrorState message={error.message} />
          </View>
        ) : null}

        <Button label="Continue" onPress={handleContinue} loading={isSubmitting} disabled={!code.trim()} />

        <View style={{ marginTop: theme.spacing.md, alignItems: 'center' }}>
          <Button label="Already have an account? Sign in" variant="secondary" onPress={() => router.replace('/(auth)/sign-in')} />
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
        Setting up onboarding for {maskedEmail}. Create a password to finish creating your account.
      </Text>

      <TextField
        label="Create password"
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

      <Button label="Create account" onPress={handleCreateAccount} loading={isSubmitting} disabled={!password || !confirmPassword} />

      <View style={{ marginTop: theme.spacing.md, alignItems: 'center' }}>
        <Button label="Back" variant="secondary" onPress={() => setStep('code')} />
      </View>
    </Screen>
  );
}
