import { useRouter } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { StepRow } from '../../../src/components/StepRow';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { LoadingState, ErrorState } from '../../../src/components/StatusStates';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSession } from '../../../src/features/onboarding/SessionContext';

// The full, interactive step list — reached via the dashboard's "Continue/
// Start Onboarding" CTA. Each row is tappable and routes to
// (app)/onboarding/[stepId], which is a real navigation architecture future
// milestones slot actual forms into (M4 instructions §14) — not a fake form
// today.
export default function OnboardingOverview() {
  const theme = useTheme();
  const router = useRouter();
  const { status, session, progress, error, refresh } = useSession();

  if (status === 'loading') {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading your onboarding checklist…" />
      </Screen>
    );
  }

  if (status === 'error' || !session || !progress) {
    return (
      <Screen scroll={false}>
        <ErrorState message={error?.message ?? 'Unable to load your onboarding checklist.'} onRetry={() => void refresh()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ProgressBar percent={session.completionPercent ?? 0} label={progress.packetName} />

      <Card style={{ marginTop: theme.spacing.lg }}>
        {progress.steps.map((step) => (
          <StepRow
            key={step.id}
            label={step.label}
            completed={step.completed}
            required={step.required}
            onPress={() => router.push({ pathname: '/(app)/onboarding/[stepId]', params: { stepId: step.id } })}
          />
        ))}
      </Card>
    </Screen>
  );
}
