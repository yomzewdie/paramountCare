import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import type { StepStatus } from '@pcs/shared';
import { Screen } from '../../../src/components/Screen';
import { ProgressBar } from '../../../src/components/ProgressBar';
import { OnboardingPhaseCard } from '../../../src/components/OnboardingPhaseCard';
import { LoadingState, ErrorState } from '../../../src/components/StatusStates';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSession } from '../../../src/features/onboarding/SessionContext';
import { groupStepsIntoPhases, findCurrentPhaseId } from '../../../src/features/onboarding/phases';

// The full onboarding journey — reached via the Onboarding tab or the
// dashboard's Continue card. Presented as four collapsible phase containers
// (not a single flat 19-row list — see phases.ts) so a nurse onboarding in
// short sessions between shifts sees "section 3 of 4," not "6 of 19 forms
// left." Each row inside an expanded phase is tappable and routes to
// (app)/onboarding/[stepId], exactly as the flat list already did — no new
// navigation, no invented step locking (canNavigateToStep is unused
// anywhere in this app today, confirmed by direct search, so arbitrary step
// access was already the existing behavior; this pass doesn't change that).
export default function OnboardingOverview() {
  const theme = useTheme();
  const router = useRouter();
  const { status, session, progress, error, refresh } = useSession();

  // M16 hardening: a submitted session's steps must never present as an
  // editable, tappable list — home.tsx already owns the authoritative
  // confirmation view, so this screen simply hands off to it rather than
  // duplicating that UI a third time (ReviewScreen being the other).
  // Reachable directly (deep link, back-navigation) even though home.tsx
  // no longer offers a "Continue Onboarding" button into here once
  // submitted — this is a UX courtesy only; the Worker's own
  // rejectIfSubmitted guard is what actually prevents any edit here from
  // taking effect regardless of whether this redirect ever ran.
  useEffect(() => {
    if (session?.status === 'submitted') {
      router.replace('/(app)/home');
    }
  }, [session?.status, router]);

  if (status === 'loading' || session?.status === 'submitted') {
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

  const phases = groupStepsIntoPhases(progress.steps);
  const currentPhaseId = findCurrentPhaseId(phases, progress.nextStep?.id);
  const stepStates = session.stepStates as Partial<Record<string, StepStatus>>;

  return (
    <Screen>
      <ProgressBar percent={session.completionPercent ?? 0} label={progress.packetName} />

      <View style={{ marginTop: theme.spacing.lg }}>
        {phases.map((phase) => {
          const isCurrent = phase.id === currentPhaseId;
          // Completed phases collapse by default (still expandable to
          // review/edit); the current phase is expanded by default and
          // visually emphasized; a future not-yet-reached phase collapses
          // too, but — per the same "no invented locking" reasoning above —
          // stays fully expandable and tappable, never gated.
          return (
            <OnboardingPhaseCard
              key={phase.id}
              phase={phase}
              isCurrent={isCurrent}
              stepStates={stepStates}
              defaultExpanded={isCurrent}
              onStepPress={(stepId) => router.push({ pathname: '/(app)/onboarding/[stepId]', params: { stepId } })}
            />
          );
        })}
      </View>
    </Screen>
  );
}
