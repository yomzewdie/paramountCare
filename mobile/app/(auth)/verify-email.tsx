import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { CodeInput } from '../../src/components/CodeInput';
import { Button } from '../../src/components/Button';
import { ErrorState, SuccessState } from '../../src/components/StatusStates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthContext';
import type { AppError } from '../../src/utils/errors';

// Mirrors the Worker's own resend cooldown (worker/src/services/emailVerification.ts,
// VERIFICATION_RESEND_COOLDOWN_SECONDS) purely as a client-side UX nicety —
// the server remains authoritative and will no-op a too-early resend
// regardless of what this countdown shows.
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmail() {
  const theme = useTheme();
  const router = useRouter();
  const { verifyEmail, resendVerification } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [verified, setVerified] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
  }, []);

  function startCooldown() {
    setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
    cooldownInterval.current = setInterval(() => {
      setCooldownRemaining((s) => {
        if (s <= 1) {
          if (cooldownInterval.current) clearInterval(cooldownInterval.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleVerify() {
    if (isSubmitting || code.length !== 6) return;
    setError(null);
    setIsSubmitting(true);
    const result = await verifyEmail(email.trim().toLowerCase(), code);
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVerified(true);
    setTimeout(() => router.replace('/(auth)/sign-in'), 1200);
  }

  async function handleResend() {
    if (cooldownRemaining > 0) return;
    setError(null);
    setResendMessage(null);
    const result = await resendVerification(email.trim().toLowerCase());
    startCooldown();
    // Always the same generic acknowledgement regardless of outcome — the
    // server deliberately never reveals whether the account/cooldown state
    // made this a real resend or a silent no-op (account-enumeration
    // hardening, see worker/src/routes/auth.ts resend-verification).
    setResendMessage(result.ok ? result.data.message : 'If an account exists and is not yet verified, a new code has been sent.');
  }

  if (verified) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <SuccessState message="Email verified. Taking you to sign in…" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Verify your email</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Enter the 6-digit code we sent to your email.
      </Text>

      {!params.email && <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />}

      <View style={{ marginBottom: theme.spacing.md, alignItems: 'center' }}>
        <CodeInput value={code} onChangeText={setCode} autoFocus />
      </View>

      {error ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <ErrorState message={error.message} />
        </View>
      ) : null}

      <Button label="Verify" onPress={handleVerify} loading={isSubmitting} disabled={code.length !== 6 || !email} />

      <View style={{ marginTop: theme.spacing.lg, alignItems: 'center' }}>
        <Button
          label={cooldownRemaining > 0 ? `Resend code (${cooldownRemaining}s)` : 'Resend code'}
          variant="secondary"
          onPress={handleResend}
          disabled={cooldownRemaining > 0 || !email}
        />
        {resendMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.sm, textAlign: 'center' }]}
          >
            {resendMessage}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
