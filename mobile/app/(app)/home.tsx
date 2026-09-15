import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { ProgressBar } from '../../src/components/ProgressBar';
import { StepRow } from '../../src/components/StepRow';
import { LoadingState, ErrorState } from '../../src/components/StatusStates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/features/auth/AuthContext';
import { useSession } from '../../src/features/onboarding/SessionContext';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';

// The real "My Onboarding" dashboard (docs/PRODUCT_ROADMAP.md item #3,
// pulled into M4). Every number and step name here comes from the
// authoritative server session via SessionContext — nothing is hardcoded or
// computed by a second, competing algorithm (M4 instructions §8–§10).
export default function Home() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { status, session, progress, error, refresh } = useSession();
  const { isConnected } = useNetworkStatus();

  if (status === 'loading') {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading your onboarding…" />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen scroll={false}>
        <ErrorState
          message={!isConnected ? "You're offline. Connect to the internet to load your onboarding." : (error?.message ?? 'Something went wrong.')}
          onRetry={() => void refresh()}
        />
      </Screen>
    );
  }

  if (!session || !progress) {
    // status === 'ready' but the packet lookup failed (see steps.ts) —
    // a distinct, honest state rather than pretending data exists.
    return (
      <Screen scroll={false}>
        <ErrorState message="We couldn't load your onboarding checklist. Please try again." onRetry={() => void refresh()} />
      </Screen>
    );
  }

  const completionPercent = session.completionPercent ?? 0;
  const ctaLabel = progress.completedSteps.length > 0 ? 'Continue Onboarding' : 'Start Onboarding';

  return (
    <Screen>
      <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginBottom: theme.spacing.xs }]}>
        PARAMOUNT CARE
      </Text>
      <Text style={[theme.typography.display, { color: theme.colors.text, marginBottom: theme.spacing.lg }]}>
        {session.firstName ? `Welcome, ${session.firstName}` : 'Welcome'}
      </Text>

      <Card style={{ marginBottom: theme.spacing.lg }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Your Onboarding</Text>
        <ProgressBar percent={completionPercent} />

        <View style={{ marginTop: theme.spacing.md }}>
          {progress.isComplete ? (
            <Text style={[theme.typography.body, { color: theme.colors.success }]}>All steps complete — under review.</Text>
          ) : (
            <>
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Next step</Text>
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{progress.nextStep?.label ?? '—'}</Text>
            </>
          )}
        </View>
      </Card>

      <View style={{ marginBottom: theme.spacing.lg }}>
        <Button label={ctaLabel} onPress={() => router.push('/(app)/onboarding')} />
      </View>

      {progress.completedSteps.length > 0 ? (
        <Card style={{ marginBottom: theme.spacing.md }}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Completed</Text>
          {progress.completedSteps.map((step) => (
            <StepRow key={step.id} label={step.label} completed required={step.required} />
          ))}
        </Card>
      ) : null}

      <Card style={{ marginBottom: theme.spacing.lg }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Remaining</Text>
        {progress.remainingSteps.map((step) => (
          <StepRow key={step.id} label={step.label} completed={false} required={step.required} />
        ))}
      </Card>

      <View>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.xs }]}>Signed in as {user?.email}</Text>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}
