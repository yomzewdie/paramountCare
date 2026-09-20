import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import type { StepStatus } from '@pcs/shared';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { ProgressBar } from '../../src/components/ProgressBar';
import { PersonalizedGreeting } from '../../src/components/PersonalizedGreeting';
import { ContinueOnboardingCard } from '../../src/components/ContinueOnboardingCard';
import { OnboardingPhaseHeader } from '../../src/components/OnboardingPhaseHeader';
import { LoadingState, ErrorState, SuccessState } from '../../src/components/StatusStates';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSession } from '../../src/features/onboarding/SessionContext';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { groupStepsIntoPhases, derivePhaseStatus, derivePhaseRequiredCounts, findCurrentPhaseId } from '../../src/features/onboarding/phases';

// The real "My Onboarding" dashboard (docs/PRODUCT_ROADMAP.md item #3,
// pulled into M4). Every number and step name here comes from the
// authoritative server session via SessionContext — nothing is hardcoded or
// computed by a second, competing algorithm (M4 instructions §8–§10).
//
// 4-phase journey pass: a 19-step flat checklist (or 12/13 for the
// specialty packets) creates form fatigue for a nurse onboarding in short
// sessions between shifts, so this screen now leads with a personalized
// greeting, overall percent, ONE next action, and a four-phase summary —
// never the raw step count as the primary framing. The full interactive
// step-by-step list (grouped the same way) is the Onboarding tab's job.
//
// App-shell modernization: sign-out now lives on the Profile tab (reachable
// from anywhere), so it is intentionally not duplicated here.
export default function Home() {
  const theme = useTheme();
  const router = useRouter();
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

  // M16 hardening (ADR-029 addendum): a submitted session must land the
  // applicant in the authoritative confirmation state — never the
  // editable step list/"Continue Onboarding" flow — on every path that
  // can bring them back here: app restart, sign-out/sign-in, cross-device
  // login, or reopening after a lost-response retry. `session.status` is
  // read fresh from the server every time (via the normal session-load
  // flow), never inferred from local/transient screen state, so this is
  // honest regardless of how the applicant got here. This is a UX
  // courtesy only — the Worker's own post-submission immutability guard
  // (routes/sessions.ts's rejectIfSubmitted) is what actually prevents
  // any edit from taking effect, independent of what this screen shows.
  if (session.status === 'submitted' && session.applicationId) {
    return (
      <Screen scroll={false}>
        <SuccessState
          message={`Application submitted. Your reference number is ${session.applicationId}. Documents received — Paramount Care Staffing, LLC will review your application within 1–2 business days.`}
        />
        <View style={{ marginTop: theme.spacing.lg }}>
          <Button label="View Application" onPress={() => router.push({ pathname: '/(app)/onboarding/[stepId]', params: { stepId: 'review' } })} />
        </View>
      </Screen>
    );
  }

  const completionPercent = session.completionPercent ?? 0;
  const phases = groupStepsIntoPhases(progress.steps);
  const currentPhaseId = findCurrentPhaseId(phases, progress.nextStep?.id);
  const stepStates = session.stepStates as Partial<Record<string, StepStatus>>;

  return (
    <Screen>
      <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginBottom: theme.spacing.xs }]}>
        PARAMOUNT CARE
      </Text>
      <View style={{ marginBottom: theme.spacing.md }}>
        <PersonalizedGreeting firstName={session.firstName} />
      </View>

      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.xs }]}>
        {progress.isComplete ? 'Every required step is complete.' : `You're ${Math.round(completionPercent)}% through onboarding.`}
      </Text>
      <View style={{ marginBottom: theme.spacing.lg }}>
        <ProgressBar percent={completionPercent} />
      </View>

      {progress.isComplete ? (
        <Card style={{ marginBottom: theme.spacing.lg, borderColor: theme.colors.success }}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.success, marginBottom: theme.spacing.xs }]}>All steps complete</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Your application is under review.</Text>
        </Card>
      ) : progress.nextStep ? (
        <ContinueOnboardingCard
          stepLabel={progress.nextStep.label}
          phaseLabel={phases.find((p) => p.id === currentPhaseId)?.label ?? progress.packetName}
          onPress={() => router.push({ pathname: '/(app)/onboarding/[stepId]', params: { stepId: progress.nextStep!.id } })}
        />
      ) : (
        // Every required step is done but at least one OPTIONAL step is
        // still incomplete (progress.nextStep is only ever null once no
        // required step remains — see steps.ts's resolveNextRequiredStep).
        // There is no single "next" step to send the applicant to here, so
        // this points at the full journey instead of fabricating one.
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.md }]}>All required steps are complete</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
            A few optional steps remain if you&rsquo;d like to complete them.
          </Text>
          <Button label="View Onboarding" variant="secondary" onPress={() => router.push('/(app)/onboarding')} />
        </Card>
      )}

      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.sm }]}>
        Your Onboarding
      </Text>
      <Card>
        {phases.map((phase, i) => {
          const phaseStatus = derivePhaseStatus(phase.steps, stepStates);
          const { completedRequired, totalRequired } = derivePhaseRequiredCounts(phase.steps);
          return (
            <View key={phase.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: theme.colors.border } : undefined}>
              <OnboardingPhaseHeader
                label={phase.label}
                status={phaseStatus}
                completedRequired={completedRequired}
                totalRequired={totalRequired}
                isCurrent={phase.id === currentPhaseId}
              />
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}
